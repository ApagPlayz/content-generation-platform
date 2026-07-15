import { prisma } from './prisma'
import { runSource } from './tools/source'
import { runClipIngest } from './tools/clipIngest'
import { runMomentDetect } from './tools/momentDetect'
import { runScript } from './tools/script'
import { runTransform } from './tools/transform'
import { runAssemble } from './tools/assemble'
import { maybeAutoPublish } from './tools/publish'
import { MAX_STAGE_ATTEMPTS, backoffMs, sleep } from './retry'
import { enforceStageBudget } from './pipeline/budget'
import type { ToolContext } from './tools/types'

/**
 * Execute one agent run: create the AgentRun + Video, then drive the pipeline
 * stage by stage. Each stage is recorded as a Job row (queue UI / retries).
 * Finished videos land in status "review" when autonomy=review, "approved"
 * when autonomy=auto (publish is Phase 2).
 *
 * v1 runs in-process (PRD §5.1 fallback: SQLite-backed jobs, no Redis).
 */
export async function executeAgentRun(agentId: string): Promise<{ runId: string; videoId: string }> {
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

  const ctx: ToolContext = {
    videoId: video.id,
    agentId,
    runId: run.id,
    factoryConfig: JSON.parse(agent.factory.config || '{}'),
    playbook: agent.playbook,
    budget: agent.budget,
  }

  try {
    await stage(ctx, 'source', async () => {
      ctx.source = await runSource(ctx.factoryConfig)
      await prisma.highlightSource.create({
        data: {
          videoId: ctx.videoId,
          strategy: ctx.source.strategy,
          sourceData: JSON.stringify(ctx.source.sourceData),
        },
      })
    })

    await stage(ctx, 'clip-ingest', async () => {
      const windowSec = Number(ctx.factoryConfig.ingestWindowSec) || undefined
      ctx.ingest = await runClipIngest(ctx.videoId, ctx.source!.youtubeQuery, windowSec)
      await prisma.highlightSource.updateMany({
        where: { videoId: ctx.videoId },
        data: { youtubeUrl: ctx.ingest.youtubeUrl },
      })
      await prisma.asset.create({
        data: {
          videoId: ctx.videoId,
          kind: 'clip',
          provider: 'yt-dlp',
          localPath: ctx.ingest.sourcePath,
          meta: JSON.stringify({ youtubeUrl: ctx.ingest.youtubeUrl }),
        },
      })
    })

    await stage(ctx, 'moment-detect', async () => {
      const clipLen = Number(ctx.factoryConfig.clipLengthSec) || 20
      ctx.moment = await runMomentDetect(ctx.ingest!.sourcePath, ctx.ingest!.durationSec, clipLen)
      await prisma.highlightSource.updateMany({
        where: { videoId: ctx.videoId },
        data: { momentStart: ctx.moment.startSec, momentEnd: ctx.moment.endSec },
      })
    })

    await stage(ctx, 'script', async () => {
      const modelOverride =
        (ctx.factoryConfig.scriptModel as string | undefined) ??
        (ctx.factoryConfig.modelTier as string | undefined)
      ctx.script = await runScript(ctx.videoId, ctx.playbook, ctx.source!, modelOverride)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: {
          title: ctx.script.title,
          description: ctx.script.description,
          hashtags: JSON.stringify(ctx.script.hashtags),
          scriptText: ctx.script.hook,
          hookScore: ctx.script.hookScore ?? null,
          hookStyle: ctx.script.hookStyle ?? null,
        },
      })
    })

    await stage(ctx, 'transform', async () => {
      // Turn the raw window into a transformative edit (commentary overlays,
      // telestration, slow-mo/punch-in). Gated by factory config; when disabled
      // or when ffmpeg can't produce a treated clip, ctx.transform stays unset
      // and assemble falls back to the raw source + original moment.
      const cfg = (ctx.factoryConfig.transform ?? {}) as { enabled?: boolean }
      if (cfg.enabled !== true) return
      const transform = await runTransform(
        ctx.ingest!.sourcePath,
        ctx.moment!,
        ctx.script!,
        ctx.factoryConfig
      )
      if (!transform) return
      ctx.transform = transform
      await prisma.asset.create({
        data: {
          videoId: ctx.videoId,
          kind: 'clip',
          provider: 'ffmpeg-transform',
          localPath: transform.treatedPath,
          meta: JSON.stringify({
            treatments: transform.treatments,
            telestrationCount: transform.telestrationCount,
            analysisLines: transform.analysisLines,
            durationSec: transform.durationSec,
          }),
        },
      })
    })

    await stage(ctx, 'assemble', async () => {
      await prisma.video.update({ where: { id: ctx.videoId }, data: { status: 'rendering' } })
      // Feed the treated clip when the transform stage produced one — its
      // moment spans the whole treated file (slow-mo may have changed the
      // length). runAssemble's signature is intentionally unchanged.
      const src = ctx.transform?.treatedPath ?? ctx.ingest!.sourcePath
      const mom = ctx.transform
        ? { startSec: 0, endSec: ctx.transform.durationSec, method: ctx.moment!.method }
        : ctx.moment!
      ctx.assembled = await runAssemble(src, mom, ctx.script!)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: { localPath: ctx.assembled.outputPath, durationSec: ctx.assembled.durationSec },
      })
    })

    const finalStatus = agent.autonomy === 'auto' ? 'approved' : 'review'
    await prisma.video.update({ where: { id: ctx.videoId }, data: { status: finalStatus } })

    // Auto agents publish straight away when the operator has opted in; this is
    // non-fatal — publishToYouTube flips the video to 'published' on success and
    // otherwise leaves it 'approved' for a manual publish from the Review inbox.
    if (finalStatus === 'approved') await maybeAutoPublish(ctx.videoId, agent.autonomy)

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date() },
    })
    return { runId: run.id, videoId: video.id }
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

async function stage(ctx: ToolContext, name: string, fn: () => Promise<void>) {
  const job = await prisma.job.create({
    data: { videoId: ctx.videoId, stage: name, status: 'running', attempts: 0, startedAt: new Date() },
  })
  // Stop before spending more once this run has hit its budget cap (issue #26).
  await enforceStageBudget(ctx.videoId, ctx.budget, job.id)
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
