import { createReadStream, existsSync } from 'fs'
import { google } from 'googleapis'
import { prisma } from '../prisma'
import { authedClient, connection, PLATFORM } from '../youtube'

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
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } })

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
          categoryId: '17', // Sports — closest default; per-factory mapping is a later refinement.
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
    const message = e instanceof Error ? e.message : String(e)
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'failed', error: message },
    })
    throw e
  }
}
