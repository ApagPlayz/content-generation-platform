import { prisma } from '../prisma'
import { gateVideoScript } from '../compliance'
import { discoverCase } from './caseDiscovery'
import { generateScript } from './script'
import { sourceVisuals } from './visuals'
import { synthesizeNarration } from './tts'
import { generateCaptions } from './captions'
import { assembleVideo } from './assemble'
import { maybeAutoPublish } from '../tools/publish'
import { MAX_STAGE_ATTEMPTS, backoffMs, sleep } from '../retry'
import type { F10Context, F10FactoryConfig, F10Stage } from './types'

/**
 * Execute one F10 True Crime run. Mirrors the F9 sports orchestrator: create the
 * AgentRun + Video, drive each stage (recorded as a Job for the queue UI), then
 * land the video at a status that reflects the COMPLIANCE GATE decision —
 *   block           → "rejected" (and we skip the expensive TTS/render)
 *   route_to_review → "review"
 *   pass            → "approved" (auto agents) / "review" (review agents)
 *
 * The gate runs after visuals are sourced so it can lint the actual imagery and
 * build the AI-disclosure plan. v1 runs in-process (PRD §5.1 SQLite-jobs path).
 */
export async function executeTrueCrimeRun(
  agentId: string
): Promise<{ runId: string; videoId: string; decision: string }> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { factory: true },
  })
  if (!agent.enabled) throw new Error(`Agent "${agent.name}" is paused`)

  const run = await prisma.agentRun.create({
    data: { agentId, status: 'running', startedAt: new Date() },
  })
  const video = await prisma.video.create({
    data: { factoryId: agent.factoryId, status: 'queued' },
  })
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { videoIds: JSON.stringify([video.id]) },
  })

  const ctx: F10Context = {
    videoId: video.id,
    agentId,
    runId: run.id,
    config: JSON.parse(agent.factory.config || '{}') as F10FactoryConfig,
    playbook: agent.playbook,
  }

  try {
    await stage(ctx, 'discover', async () => {
      ctx.brief = await discoverCase(ctx.config)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: { sourceRef: ctx.brief.wikipediaUrl },
      })
      await prisma.asset.create({
        data: {
          videoId: ctx.videoId,
          kind: 'case-brief',
          provider: 'wikipedia',
          meta: JSON.stringify(ctx.brief),
        },
      })
    })

    await stage(ctx, 'script', async () => {
      ctx.script = await generateScript(ctx.videoId, ctx.playbook, ctx.brief!, ctx.config)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: {
          title: ctx.script.title,
          description: ctx.script.description,
          hashtags: JSON.stringify(ctx.script.hashtags),
          scriptText: ctx.script.narration,
        },
      })
      // Persist the beat-structured plan (hook + beats) so the footage and
      // render phases can pace cuts and source per-beat b-roll.
      if (ctx.script.beats?.length) {
        await prisma.asset.create({
          data: {
            videoId: ctx.videoId,
            kind: 'script-plan',
            provider: 'f10-beats',
            meta: JSON.stringify({ hook: ctx.script.hook, beats: ctx.script.beats }),
          },
        })
      }
    })

    await stage(ctx, 'visuals', async () => {
      const { visuals, imagePaths } = await sourceVisuals(
        ctx.videoId,
        ctx.brief!,
        ctx.config.maxImages ?? 6
      )
      ctx.visuals = visuals
      ctx.imagePaths = imagePaths
      ctx.script!.visuals = visuals // gate lints the real imagery
      for (let i = 0; i < visuals.length; i++) {
        await prisma.asset.create({
          data: {
            videoId: ctx.videoId,
            kind: 'image',
            provider: 'wikimedia-commons',
            localPath: imagePaths[i],
            meta: JSON.stringify(visuals[i]),
          },
        })
      }
    })

    // ── Compliance gate — the decision point ──
    await stage(ctx, 'compliance', async () => {
      const { report } = await gateVideoScript(ctx.script!, {
        videoId: ctx.videoId,
        generatedAt: new Date().toISOString(),
      })
      ctx.complianceDecision = report.decision
    })

    if (ctx.complianceDecision === 'block') {
      await prisma.video.update({ where: { id: ctx.videoId }, data: { status: 'rejected' } })
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: 'completed', finishedAt: new Date() },
      })
      await finalizeCost(ctx.videoId)
      return { runId: run.id, videoId: video.id, decision: 'block' }
    }

    await stage(ctx, 'tts', async () => {
      ctx.tts = await synthesizeNarration(ctx.videoId, ctx.script!.narration, ctx.config.voice)
      await prisma.asset.create({
        data: {
          videoId: ctx.videoId,
          kind: 'audio',
          provider: ctx.tts.provider,
          localPath: ctx.tts.audioPath,
        },
      })
    })

    await stage(ctx, 'captions', async () => {
      ctx.captions = await generateCaptions(
        ctx.tts!.audioPath,
        ctx.script!.narration,
        ctx.tts!.durationSec,
        ctx.tts!.words
      )
      await prisma.asset.create({
        data: {
          videoId: ctx.videoId,
          kind: 'captions',
          provider: ctx.captions.method,
          localPath: ctx.captions.captionsPath,
        },
      })
    })

    await stage(ctx, 'assemble', async () => {
      await prisma.video.update({ where: { id: ctx.videoId }, data: { status: 'rendering' } })
      ctx.render = await assembleVideo(
        ctx.imagePaths ?? [],
        ctx.tts!.audioPath,
        ctx.tts!.durationSec,
        ctx.captions!
      )
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: {
          localPath: ctx.render.outputPath ?? undefined,
          durationSec: Math.round(ctx.render.durationSec),
        },
      })
      if (ctx.render.outputPath) {
        await prisma.asset.create({
          data: { videoId: ctx.videoId, kind: 'video', provider: 'ffmpeg', localPath: ctx.render.outputPath },
        })
      }
    })

    await finalizeCost(ctx.videoId)

    const finalStatus =
      ctx.complianceDecision === 'route_to_review'
        ? 'review'
        : agent.autonomy === 'auto'
          ? 'approved'
          : 'review'
    await prisma.video.update({ where: { id: ctx.videoId }, data: { status: finalStatus } })

    // Auto-publish only a clean compliance 'pass' for auto agents (a
    // 'route_to_review' decision already forced finalStatus to 'review').
    if (finalStatus === 'approved') await maybeAutoPublish(ctx.videoId, agent.autonomy)

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date() },
    })
    return { runId: run.id, videoId: video.id, decision: ctx.complianceDecision ?? 'pass' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await prisma.video.update({ where: { id: ctx.videoId }, data: { status: 'failed' } })
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    })
    throw e
  }
}

async function finalizeCost(videoId: string): Promise<void> {
  const ledger = await prisma.costLedger.aggregate({
    where: { videoId },
    _sum: { total: true },
  })
  await prisma.video.update({
    where: { id: videoId },
    data: { costEstimate: ledger._sum.total ?? 0 },
  })
}

async function stage(ctx: F10Context, name: F10Stage, fn: () => Promise<void>): Promise<void> {
  const job = await prisma.job.create({
    data: { videoId: ctx.videoId, stage: name, status: 'running', attempts: 0, startedAt: new Date() },
  })
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_STAGE_ATTEMPTS; attempt++) {
    await prisma.job.update({ where: { id: job.id }, data: { attempts: attempt, status: 'running' } })
    try {
      await fn()
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'completed', finishedAt: new Date() },
      })
      return
    } catch (e) {
      lastErr = e
      const error = e instanceof Error ? e.message : String(e)
      if (attempt < MAX_STAGE_ATTEMPTS) {
        await prisma.job.update({ where: { id: job.id }, data: { status: 'retrying', error } })
        await sleep(backoffMs(attempt))
        continue
      }
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'failed', error, finishedAt: new Date() },
      })
      throw e
    }
  }
  throw lastErr
}
