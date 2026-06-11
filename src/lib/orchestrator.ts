import { prisma } from './prisma'
import { runSource } from './tools/source'
import { runClipIngest } from './tools/clipIngest'
import { runMomentDetect } from './tools/momentDetect'
import { runScript } from './tools/script'
import { runAssemble } from './tools/assemble'
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
      ctx.ingest = await runClipIngest(ctx.videoId, ctx.source!.youtubeQuery)
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
      ctx.script = await runScript(ctx.videoId, ctx.playbook, ctx.source!)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: {
          title: ctx.script.title,
          description: ctx.script.description,
          hashtags: JSON.stringify(ctx.script.hashtags),
          scriptText: ctx.script.hook,
        },
      })
    })

    await stage(ctx, 'assemble', async () => {
      await prisma.video.update({ where: { id: ctx.videoId }, data: { status: 'rendering' } })
      ctx.assembled = await runAssemble(ctx.ingest!.sourcePath, ctx.moment!, ctx.script!)
      await prisma.video.update({
        where: { id: ctx.videoId },
        data: { localPath: ctx.assembled.outputPath, durationSec: ctx.assembled.durationSec },
      })
    })

    const finalStatus = agent.autonomy === 'auto' ? 'approved' : 'review'
    await prisma.video.update({ where: { id: ctx.videoId }, data: { status: finalStatus } })
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
    data: { videoId: ctx.videoId, stage: name, status: 'running', attempts: 1, startedAt: new Date() },
  })
  try {
    await fn()
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'completed', finishedAt: new Date() },
    })
  } catch (e) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date(),
      },
    })
    throw e
  }
}
