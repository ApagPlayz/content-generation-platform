import { google } from 'googleapis'
import type { Metric } from '@prisma/client'
import { prisma } from '../prisma'
import { authedClient, connection, hasAnalyticsScope, PLATFORM } from '../youtube'

/**
 * Analytics read tool (PRD Phase 2). Polls YouTube Data API v3
 * `videos.list?part=statistics` for view/like/comment counts on every published
 * Short, AND — when the connection carries the `yt-analytics.readonly` scope —
 * the YouTube Analytics API v2 for watch time, average view %, and subscribers
 * gained. Records a fresh Metric snapshot per refresh so the Winners leaderboard
 * can rank by views and each Metric row stays a point-in-time data point.
 *
 * If the analytics scope is absent (e.g. a connection made before it was added),
 * the deeper metrics are simply left null and the basic counts still refresh —
 * the operator just needs to reconnect YouTube in Settings to enable them.
 */

// videos.list accepts at most 50 ids per call.
const MAX_IDS_PER_CALL = 50

// YouTube was founded in 2005 — a safe "since the beginning of time" start date
// for lifetime analytics totals.
const ANALYTICS_START_DATE = '2005-01-01'

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function toInt(v: string | null | undefined): number | null {
  if (v == null) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

interface DeepMetrics {
  watchTimeSec: number | null
  avgWatchPct: number | null
  followsGained: number | null
}

function todayUTCDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Lifetime watch time / avg view % / subscribers gained per video via the
 * YouTube Analytics API, keyed by YouTube video id. Returns an empty map (never
 * throws) when the scope is missing or the API errors, so the basic-stats
 * refresh always proceeds.
 */
async function fetchDeepMetrics(
  auth: Awaited<ReturnType<typeof authedClient>>,
  ytIds: string[]
): Promise<Map<string, DeepMetrics>> {
  const out = new Map<string, DeepMetrics>()
  if (ytIds.length === 0 || !(await hasAnalyticsScope())) return out

  try {
    const ya = google.youtubeAnalytics({ version: 'v2', auth })
    // One row per video via the `video` dimension; filter to our id set.
    for (const ids of chunk(ytIds, 50)) {
      const res = await ya.reports.query({
        ids: 'channel==MINE',
        startDate: ANALYTICS_START_DATE,
        endDate: todayUTCDate(),
        metrics: 'estimatedMinutesWatched,averageViewPercentage,subscribersGained',
        dimensions: 'video',
        filters: `video==${ids.join(',')}`,
      })
      for (const row of res.data.rows ?? []) {
        // Column order matches `dimensions` then `metrics`.
        const [videoId, minutes, avgPct, subs] = row as [string, number, number, number]
        out.set(videoId, {
          watchTimeSec: Number.isFinite(minutes) ? Math.round(minutes * 60) : null,
          avgWatchPct: Number.isFinite(avgPct) ? avgPct : null,
          followsGained: Number.isFinite(subs) ? Math.round(subs) : null,
        })
      }
    }
  } catch (e) {
    // Insufficient scope / no data / transient error — degrade to basic stats.
    console.warn('[analytics] deep metrics unavailable:', e instanceof Error ? e.message : e)
  }
  return out
}

/**
 * Polls YouTube for fresh statistics on every published post and writes a new
 * Metric snapshot for each. Returns how many posts got a fresh snapshot vs. how
 * many were skipped (no platformPostId, or no statistics returned). Treats "not
 * connected" / "no posts" as an empty success rather than an error.
 */
export async function refreshAllMetrics(): Promise<{ updated: number; skipped: number }> {
  const conn = await connection()
  if (!conn) return { updated: 0, skipped: 0 }

  const posts = await prisma.post.findMany({
    where: { platform: PLATFORM, status: 'published' },
  })

  // Only posts with a YouTube video id can be looked up.
  const livePosts = posts.filter((p) => !!p.platformPostId)
  if (livePosts.length === 0) {
    return { updated: 0, skipped: posts.length }
  }

  // Map YouTube video id -> our post, so we can attribute each returned item.
  const byPlatformId = new Map<string, (typeof livePosts)[number]>()
  for (const p of livePosts) byPlatformId.set(p.platformPostId as string, p)

  let updated = 0

  try {
    const auth = await authedClient()
    const yt = google.youtube({ version: 'v3', auth })

    // Deeper, scope-gated metrics for the whole id set up front (best-effort).
    const deep = await fetchDeepMetrics(auth, [...byPlatformId.keys()])

    for (const ids of chunk([...byPlatformId.keys()], MAX_IDS_PER_CALL)) {
      const res = await yt.videos.list({ part: ['statistics'], id: ids })
      for (const item of res.data.items ?? []) {
        const post = item.id ? byPlatformId.get(item.id) : undefined
        if (!post) continue
        const stats = item.statistics
        if (!stats) continue
        const d = (item.id && deep.get(item.id)) || null

        await prisma.metric.create({
          data: {
            postId: post.id,
            videoId: post.videoId,
            views: toInt(stats.viewCount),
            likes: toInt(stats.likeCount),
            comments: toInt(stats.commentCount),
            // From the YouTube Analytics API when the scope is granted, else null.
            watchTimeSec: d?.watchTimeSec ?? null,
            avgWatchPct: d?.avgWatchPct ?? null,
            followsGained: d?.followsGained ?? null,
            raw: JSON.stringify(stats),
          },
        })
        updated++
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to refresh YouTube metrics: ${message}`)
  }

  return { updated, skipped: livePosts.length - updated + (posts.length - livePosts.length) }
}

/**
 * For each published post, its most recent Metric snapshot. Keyed by post id.
 * A per-post findFirst is fine at this scale.
 */
export async function latestMetricsByPost(): Promise<Map<string, Metric>> {
  const posts = await prisma.post.findMany({
    where: { platform: PLATFORM, status: 'published' },
    select: { id: true },
  })

  const out = new Map<string, Metric>()
  for (const { id } of posts) {
    const metric = await prisma.metric.findFirst({
      where: { postId: id },
      orderBy: { capturedAt: 'desc' },
    })
    if (metric) out.set(id, metric)
  }
  return out
}
