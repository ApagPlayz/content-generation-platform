import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PLATFORM } from '@/lib/youtube'
import { refreshAllMetrics, latestMetricsByPost } from '@/lib/tools/analytics'
import { refreshAgentMemories } from '@/lib/tools/winnerDigest'

// POST: poll YouTube and write a fresh Metric snapshot per published post, then
// recompute each agent's "what's winning" digest so the next run learns from it.
export async function POST() {
  try {
    const result = await refreshAllMetrics()
    // Close the analytics feedback loop (PRD goal #5). Best-effort: a digest
    // failure must never sink a successful metrics refresh.
    try {
      await refreshAgentMemories()
    } catch (e) {
      console.warn('[analytics] winner digest refresh failed:', e instanceof Error ? e.message : e)
    }
    return NextResponse.json(result)
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to refresh metrics'
    return NextResponse.json({ error }, { status: 500 })
  }
}

// GET: small summary for the Winners view header.
export async function GET() {
  const publishedPosts = await prisma.post.count({
    where: { platform: PLATFORM, status: 'published' },
  })

  const latest = await latestMetricsByPost()
  const totalViews = [...latest.values()].reduce((sum, m) => sum + (m.views ?? 0), 0)

  const lastMetric = await prisma.metric.findFirst({ orderBy: { capturedAt: 'desc' } })

  return NextResponse.json({
    publishedPosts,
    totalViews,
    lastRefreshedAt: lastMetric?.capturedAt ?? null,
  })
}
