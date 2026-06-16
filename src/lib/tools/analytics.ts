import { google } from 'googleapis'
import type { Metric } from '@prisma/client'
import { prisma } from '../prisma'
import { authedClient, connection, PLATFORM } from '../youtube'

/**
 * Analytics read tool (PRD Phase 2). Polls YouTube Data API v3
 * `videos.list?part=statistics` for every published Short and records a new
 * Metric snapshot per refresh, so the Winners leaderboard can rank by views and
 * each Metric row stays a point-in-time data point.
 *
 * Scope note: our OAuth grants only `youtube.upload` + `youtube.readonly`, NOT
 * `youtubeAnalytics`. The Data API statistics endpoint exposes viewCount /
 * likeCount / commentCount / favoriteCount only — so watchTimeSec, avgWatchPct,
 * and followsGained are left null here. Capturing those requires adding the
 * `https://www.googleapis.com/auth/yt-analytics.readonly` scope and the
 * YouTube Analytics API (a later enhancement).
 */

// videos.list accepts at most 50 ids per call.
const MAX_IDS_PER_CALL = 50

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
    const yt = google.youtube({ version: 'v3', auth: await authedClient() })

    for (const ids of chunk([...byPlatformId.keys()], MAX_IDS_PER_CALL)) {
      const res = await yt.videos.list({ part: ['statistics'], id: ids })
      for (const item of res.data.items ?? []) {
        const post = item.id ? byPlatformId.get(item.id) : undefined
        if (!post) continue
        const stats = item.statistics
        if (!stats) continue

        await prisma.metric.create({
          data: {
            postId: post.id,
            videoId: post.videoId,
            views: toInt(stats.viewCount),
            likes: toInt(stats.likeCount),
            comments: toInt(stats.commentCount),
            // watchTimeSec / avgWatchPct / followsGained require the
            // youtubeAnalytics scope (see file header) — left null.
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
