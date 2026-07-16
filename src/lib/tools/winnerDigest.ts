import { prisma } from '../prisma'
import { PLATFORM } from '../youtube'
import { latestMetricsByPost } from './analytics'

/**
 * The analytics "learn from winners" loop (PRD goal #5 — the closed feedback
 * loop). After metrics refresh we rank each agent's published videos by views
 * and write a short plain-text "what's winning" digest into the agent's
 * `Agent.memory` field. The script stage reads that digest back and biases the
 * next run's hooks/angles toward what already works — instead of generating
 * blind. The digest is intentionally plain English: it is shown to the owner on
 * the dashboard AND fed to the model as a soft prompt bias.
 *
 * v1 scope: bias the script/ideation stage and fill memory. Reordering the
 * calendar-rotation topic pick (source.ts) is a deliberate follow-up.
 */

/** One published video's performance, already attributed to an agent. */
export interface VideoPerf {
  title: string | null
  hookStyle: string | null
  views: number
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function title(v: VideoPerf): string {
  return (v.title ?? 'Untitled video').trim() || 'Untitled video'
}

/**
 * Build the plain-text winners digest for a single agent from its published
 * videos. Pure and deterministic (given `asOf`) so it is trivially unit-tested.
 * Returns null when there is nothing to learn from yet (no videos / no views),
 * so callers can leave `Agent.memory` empty rather than write a hollow summary.
 */
export function buildDigestText(perf: VideoPerf[], asOf: Date): string | null {
  const withViews = perf.filter((p) => p.views > 0)
  if (withViews.length === 0) return null

  const ranked = [...withViews].sort((a, b) => b.views - a.views)
  const lines: string[] = [`What's winning (as of ${asOf.toISOString().slice(0, 10)}):`]

  lines.push('Top performers:')
  ranked.slice(0, 3).forEach((v, i) => {
    const hook = v.hookStyle ? ` · ${v.hookStyle} hook` : ''
    lines.push(`${i + 1}. "${title(v)}" — ${fmt(v.views)} views${hook}`)
  })

  // Best hook style = the style with the highest average views across the
  // videos that actually carry one. Only surfaced when there is a signal.
  const byStyle = new Map<string, { total: number; count: number }>()
  for (const v of ranked) {
    if (!v.hookStyle) continue
    const g = byStyle.get(v.hookStyle) ?? { total: 0, count: 0 }
    g.total += v.views
    g.count += 1
    byStyle.set(v.hookStyle, g)
  }
  const bestStyle = [...byStyle.entries()]
    .map(([style, g]) => ({ style, avg: g.total / g.count }))
    .sort((a, b) => b.avg - a.avg)[0]
  if (bestStyle) lines.push(`Best hook style: ${bestStyle.style}.`)

  // A single weakest data point keeps "cut what doesn't work" concrete.
  if (ranked.length > 1) {
    const worst = ranked[ranked.length - 1]
    lines.push(`Weakest so far: "${title(worst)}" — ${fmt(worst.views)} views.`)
  }

  lines.push('Lean toward the proven topics and hooks above — make more like the winners.')
  return lines.join('\n')
}

/**
 * Recompute every agent's winners digest from the latest Metric snapshots and
 * persist it to `Agent.memory`. Videos are attributed to the agent that made
 * them via `AgentRun.videoIds` (the JSON list written when a run starts).
 * Best-effort: returns how many agents got a fresh digest. Never throws for the
 * "nothing published yet" case — it just writes nothing.
 */
export async function refreshAgentMemories(asOf: Date = new Date()): Promise<{ agents: number }> {
  // videoId -> agentId, from every run that produced a video (latest run wins).
  const runs = await prisma.agentRun.findMany({
    where: { videoIds: { not: null } },
    select: { agentId: true, videoIds: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const videoToAgent = new Map<string, string>()
  for (const r of runs) {
    let ids: unknown
    try {
      ids = JSON.parse(r.videoIds ?? '[]')
    } catch {
      continue
    }
    if (Array.isArray(ids)) for (const id of ids) videoToAgent.set(String(id), r.agentId)
  }
  if (videoToAgent.size === 0) return { agents: 0 }

  // Latest view count per published video (via its post's most recent Metric).
  const posts = await prisma.post.findMany({
    where: { platform: PLATFORM, status: 'published' },
    select: { id: true, videoId: true },
  })
  const latest = await latestMetricsByPost()
  const videoViews = new Map<string, number>()
  for (const p of posts) {
    const views = latest.get(p.id)?.views ?? 0
    // A video can have at most one post per platform, but guard anyway.
    videoViews.set(p.videoId, Math.max(videoViews.get(p.videoId) ?? 0, views))
  }

  const videoIds = [...videoViews.keys()].filter((id) => videoToAgent.has(id))
  if (videoIds.length === 0) return { agents: 0 }

  const videos = await prisma.video.findMany({
    where: { id: { in: videoIds } },
    select: { id: true, title: true, hookStyle: true },
  })

  // Group each agent's videos, build the digest, persist to Agent.memory.
  const perfByAgent = new Map<string, VideoPerf[]>()
  for (const v of videos) {
    const agentId = videoToAgent.get(v.id)
    if (!agentId) continue
    const list = perfByAgent.get(agentId) ?? []
    list.push({ title: v.title, hookStyle: v.hookStyle, views: videoViews.get(v.id) ?? 0 })
    perfByAgent.set(agentId, list)
  }

  let count = 0
  for (const [agentId, perf] of perfByAgent) {
    const digest = buildDigestText(perf, asOf)
    if (!digest) continue
    await prisma.agent.update({ where: { id: agentId }, data: { memory: digest } })
    count++
  }
  return { agents: count }
}
