import { createReadStream, existsSync } from 'fs'
import { google } from 'googleapis'
import { prisma } from '../prisma'
import { autoPublishEnabled, tiktokAutoPublishEnabled } from '../settings'
import {
  authedClient,
  connection,
  isAuthError,
  markNeedsReconnect,
  PLATFORM,
  YT_RECONNECT_MESSAGE,
} from '../youtube'
import {
  connection as tiktokConnection,
  directPost,
  PLATFORM as TIKTOK_PLATFORM,
  tiktokPermalink,
} from '../tiktok'

/**
 * Publish tool (PRD §8.1 / Phase 2). Uploads a rendered Short to YouTube via
 * Data API v3 `videos.insert`, records a Post row + permalink, and logs the
 * ~1600-unit quota cost. Idempotent per (video, platform): a video already
 * published to YouTube is returned as-is rather than re-uploaded.
 */

// A single upload costs ~1600 of the default 10,000 units/day quota (PRD §8.1).
const UPLOAD_QUOTA_UNITS = 1600

const DEFAULT_DAILY_CAP = 6
const DEFAULT_PRIVACY = 'unlisted'

// YouTube category id per factory type (videoCategories.list, region US). True
// crime / reddit narration sit best under People & Blogs; sports under Sports.
// Falls back to People & Blogs (22) — the safe neutral default — for unknown types.
const CATEGORY_BY_FACTORY: Record<string, string> = {
  F9: '17', // Sports highlights
  F10: '22', // True Crime → People & Blogs
  F11: '27', // History & Business Mini-Docs → Education
  F1: '22', // Reddit stories → People & Blogs
}
const DEFAULT_CATEGORY = '22' // People & Blogs

async function setting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value || fallback
}

function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Uploads published today vs the configured daily cap (the ~6/day quota wall). */
export async function quotaStatus(): Promise<{
  used: number
  cap: number
  remaining: number
}> {
  const cap = parseInt(await setting('youtube_daily_quota_cap', String(DEFAULT_DAILY_CAP)), 10)
  const used = await prisma.post.count({
    where: {
      platform: PLATFORM,
      status: 'published',
      publishedAt: { gte: startOfTodayUTC() },
    },
  })
  return { used, cap, remaining: Math.max(0, cap - used) }
}

export interface PublishResult {
  postId: string
  platformPostId: string
  permalink: string
  alreadyPublished: boolean
}

export async function publishToYouTube(videoId: string): Promise<PublishResult> {
  const video = await prisma.video.findUniqueOrThrow({
    where: { id: videoId },
    include: { factory: { select: { type: true } } },
  })

  // Idempotency: don't re-upload a video that already has a live YouTube post.
  const existing = await prisma.post.findUnique({
    where: { videoId_platform: { videoId, platform: PLATFORM } },
  })
  if (existing?.status === 'published' && existing.platformPostId) {
    return {
      postId: existing.id,
      platformPostId: existing.platformPostId,
      permalink: existing.permalink || `https://youtube.com/watch?v=${existing.platformPostId}`,
      alreadyPublished: true,
    }
  }

  if (!video.localPath || !existsSync(video.localPath)) {
    throw new Error('Rendered MP4 not found for this video — render it before publishing.')
  }

  const conn = await connection()
  if (!conn) throw new Error('YouTube is not connected. Connect it in Settings first.')

  const { remaining, cap } = await quotaStatus()
  if (remaining <= 0) {
    throw new Error(
      `Daily YouTube upload quota reached (${cap}/day). Try again tomorrow or raise the cap in Settings.`
    )
  }

  const privacy = await setting('youtube_privacy', DEFAULT_PRIVACY)
  const hashtags: string[] = video.hashtags ? JSON.parse(video.hashtags) : []

  // A Short needs vertical ≤60s + "#Shorts" in title/description (PRD §8.1).
  const title = (video.title || 'Untitled').slice(0, 95)
  const descParts = [video.description || '', hashtags.map((h) => `#${h}`).join(' '), '#Shorts']
  const description = descParts.filter(Boolean).join('\n\n').slice(0, 4900)

  // Mark intent before the network call so a crash mid-upload is visible.
  const post = await prisma.post.upsert({
    where: { videoId_platform: { videoId, platform: PLATFORM } },
    update: { status: 'publishing', error: null },
    create: { videoId, platform: PLATFORM, status: 'publishing' },
  })

  try {
    const auth = await authedClient()
    const yt = google.youtube({ version: 'v3', auth })
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: hashtags.slice(0, 15),
          categoryId: CATEGORY_BY_FACTORY[video.factory.type] ?? DEFAULT_CATEGORY,
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false,
        },
      },
      media: { body: createReadStream(video.localPath) },
    })

    const ytId = res.data.id
    if (!ytId) throw new Error('YouTube did not return a video id')
    const permalink = `https://youtube.com/watch?v=${ytId}`

    const updated = await prisma.post.update({
      where: { id: post.id },
      data: {
        platformPostId: ytId,
        permalink,
        status: 'published',
        publishedAt: new Date(),
        error: null,
      },
    })

    await prisma.video.update({ where: { id: videoId }, data: { status: 'published' } })

    // Quota is free but metered — record units so the meter/ledger can sum them.
    await prisma.costLedger.create({
      data: {
        videoId,
        service: 'youtube_upload',
        units: UPLOAD_QUOTA_UNITS,
        unitCost: 0,
        total: 0,
      },
    })

    return {
      postId: updated.id,
      platformPostId: ytId,
      permalink,
      alreadyPublished: false,
    }
  } catch (e) {
    // A dead OAuth login must stop being painted green in Settings. Flip the
    // connection to needs_reconnect so the UI prompts a re-login and the next
    // publish short-circuits at the "not connected" gate — and record the reason
    // in plain language instead of raw `invalid_grant`.
    if (isAuthError(e)) {
      await markNeedsReconnect()
      await prisma.post.update({
        where: { id: post.id },
        data: { status: 'failed', error: YT_RECONNECT_MESSAGE },
      })
      throw new Error(YT_RECONNECT_MESSAGE)
    }
    const message = e instanceof Error ? e.message : String(e)
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'failed', error: message },
    })
    throw e
  }
}

// TikTok publishes to the profile directly (no daily quota wall like YouTube's).
// A fresh, un-audited TikTok app can only post privately — SELF_ONLY — until
// TikTok approves it for public posting, so that's the safe default.
const TIKTOK_DEFAULT_PRIVACY = 'SELF_ONLY'

/**
 * Publish a rendered Short to TikTok via the Content Posting API. Same shape and
 * guarantees as publishToYouTube: idempotent per (video, platform) — a video
 * already live on TikTok is returned as-is rather than re-uploaded.
 */
export async function publishToTikTok(videoId: string): Promise<PublishResult> {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } })

  // Idempotency: don't re-upload a video that already has a live TikTok post.
  const existing = await prisma.post.findUnique({
    where: { videoId_platform: { videoId, platform: TIKTOK_PLATFORM } },
  })
  if (existing?.status === 'published' && existing.platformPostId) {
    return {
      postId: existing.id,
      platformPostId: existing.platformPostId,
      permalink: existing.permalink || tiktokPermalink('', existing.platformPostId),
      alreadyPublished: true,
    }
  }

  if (!video.localPath || !existsSync(video.localPath)) {
    throw new Error('Rendered MP4 not found for this video — render it before publishing.')
  }

  const conn = await tiktokConnection()
  if (!conn) throw new Error('TikTok is not connected. Connect it in Settings first.')

  const privacy = await setting('tiktok_privacy', TIKTOK_DEFAULT_PRIVACY)
  const hashtags: string[] = video.hashtags ? JSON.parse(video.hashtags) : []
  const caption = [video.title || '', hashtags.map((h) => `#${h}`).join(' ')]
    .filter(Boolean)
    .join(' ')

  // Mark intent before the network call so a crash mid-upload is visible.
  const post = await prisma.post.upsert({
    where: { videoId_platform: { videoId, platform: TIKTOK_PLATFORM } },
    update: { status: 'publishing', error: null },
    create: { videoId, platform: TIKTOK_PLATFORM, status: 'publishing' },
  })

  try {
    const { publishId, postId } = await directPost({
      filePath: video.localPath,
      caption,
      privacy,
    })
    const platformPostId = postId || publishId
    const permalink = tiktokPermalink(conn.accountHandle, postId)

    const updated = await prisma.post.update({
      where: { id: post.id },
      data: {
        platformPostId,
        permalink,
        status: 'published',
        publishedAt: new Date(),
        error: null,
      },
    })

    await prisma.video.update({ where: { id: videoId }, data: { status: 'published' } })

    await prisma.costLedger.create({
      data: { videoId, service: 'tiktok_publish', units: 1, unitCost: 0, total: 0 },
    })

    return { postId: updated.id, platformPostId, permalink, alreadyPublished: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'failed', error: message },
    })
    throw e
  }
}

export type AutoPublishOutcome =
  | { published: true; permalink: string }
  | { published: false; reason: string }

// Expected, non-error skip states — the operator chose these on purpose, so they
// must NOT be recorded or painted as failures (that would flag every auto video
// red whenever auto-publish is simply switched off).
export const AUTO_PUBLISH_REVIEW_GATED = 'agent is review-gated'
export const AUTO_PUBLISH_DISABLED = 'auto-publish disabled in Settings'

/**
 * True when a "didn't publish" reason is a genuine, actionable problem worth
 * recording and showing the owner (YouTube not connected, quota reached, upload
 * rejected) — as opposed to an expected opt-out state.
 */
export function isAutoPublishFailure(reason: string): boolean {
  return reason !== AUTO_PUBLISH_REVIEW_GATED && reason !== AUTO_PUBLISH_DISABLED
}

/**
 * Record a genuine "wanted to publish but couldn't" as a failed youtube Post so
 * the dashboard can surface it in plain language. Never clobbers a real
 * published post, and never throws — this bookkeeping must not fail a good run.
 */
async function recordAutoPublishFailure(
  videoId: string,
  platform: string,
  reason: string
): Promise<void> {
  try {
    const existing = await prisma.post.findUnique({
      where: { videoId_platform: { videoId, platform } },
    })
    if (existing?.status === 'published') return
    await prisma.post.upsert({
      where: { videoId_platform: { videoId, platform } },
      update: { status: 'failed', error: reason },
      create: { videoId, platform, status: 'failed', error: reason },
    })
  } catch {
    // A logging hiccup must never fail an otherwise-good run.
  }
}

/**
 * One publishing destination. Each platform is independent: its own on/off
 * switch, its own connection, and its own publish call. The registry is what
 * makes auto-publish multi-platform (issue #19) — adding Instagram later is a
 * third entry, nothing else changes.
 */
interface PlatformAdapter {
  platform: string
  /** Human name used in "<label> not connected" messages. */
  label: string
  /** The operator's per-platform auto-publish toggle. */
  isAutoEnabled: () => Promise<boolean>
  isConnected: () => Promise<boolean>
  /** Optional pre-flight gate (e.g. YouTube's daily quota); reason or null. */
  preflight?: () => Promise<string | null>
  publish: (videoId: string) => Promise<{ permalink: string }>
}

const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  {
    platform: PLATFORM,
    label: 'YouTube',
    isAutoEnabled: autoPublishEnabled,
    isConnected: async () => !!(await connection()),
    preflight: async () => {
      const { remaining, cap } = await quotaStatus()
      return remaining <= 0 ? `daily upload quota reached (${cap}/day)` : null
    },
    publish: async (videoId) => ({ permalink: (await publishToYouTube(videoId)).permalink }),
  },
  {
    platform: TIKTOK_PLATFORM,
    label: 'TikTok',
    isAutoEnabled: tiktokAutoPublishEnabled,
    isConnected: async () => !!(await tiktokConnection()),
    publish: async (videoId) => ({ permalink: (await publishToTikTok(videoId)).permalink }),
  },
]

// Decide one platform's outcome. Order matters: the "switched off" check comes
// first so a platform the owner hasn't opted into is a silent skip (DISABLED,
// not recorded) — never a red "didn't post" on the dashboard.
async function computeAdapter(
  a: PlatformAdapter,
  videoId: string
): Promise<AutoPublishOutcome> {
  if (!(await a.isAutoEnabled())) return { published: false, reason: AUTO_PUBLISH_DISABLED }
  if (!(await a.isConnected())) return { published: false, reason: `${a.label} not connected` }
  const pre = a.preflight ? await a.preflight() : null
  if (pre) return { published: false, reason: pre }
  try {
    return { published: true, permalink: (await a.publish(videoId)).permalink }
  } catch (e) {
    return { published: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

async function runAdapter(a: PlatformAdapter, videoId: string): Promise<AutoPublishOutcome> {
  const outcome = await computeAdapter(a, videoId)
  if (!outcome.published && isAutoPublishFailure(outcome.reason)) {
    await recordAutoPublishFailure(videoId, a.platform, outcome.reason)
  }
  return outcome
}

/**
 * Auto-publish hook for autonomy=auto agents. Called by the orchestrators after
 * a video is approved. It is deliberately NON-FATAL: any reason a platform can't
 * publish (feature off, not connected, daily quota spent, upload error) leaves
 * the video 'approved' for a later manual publish rather than throwing — a
 * publish hiccup must never fail an otherwise-good run.
 *
 * Every connected + switched-on platform is attempted independently, so one
 * generated video can land on YouTube AND TikTok from a single run. Genuine
 * failures (not the expected opt-out states) are persisted as a failed Post on
 * that platform so the dashboard can tell the owner WHY a video didn't post.
 */
export async function maybeAutoPublish(
  videoId: string,
  autonomy: string
): Promise<AutoPublishOutcome> {
  // Review mode blocks every platform — nothing auto-posts until a human approves.
  if (autonomy !== 'auto') return { published: false, reason: AUTO_PUBLISH_REVIEW_GATED }

  const outcomes: AutoPublishOutcome[] = []
  for (const a of PLATFORM_ADAPTERS) {
    outcomes.push(await runAdapter(a, videoId))
  }
  // Report a real success if any platform posted; otherwise fall back to the
  // first (YouTube) outcome so existing callers keep the same result shape.
  return outcomes.find((o) => o.published) ?? outcomes[0]
}
