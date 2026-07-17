// F11 History/Business-story orchestrator — a structural clone of the F10 True
// Crime orchestrator that swaps in topic discovery + the history script writer
// and passes HISTORY_PROFILE to the shared compliance gate. Every generic
// stage (footage ladder, Wikimedia visuals floor, TTS, captions, assemble) is
// REUSED from src/lib/truecrime/* by import, not copied.
//
// Stage order is the shared INVARIANT: discover → script → footage → visuals →
// compliance → tts → captions → assemble. The visuals stage merges ALL imagery
// onto ctx.script.visuals BEFORE compliance so the gate lints real imagery.

import { prisma } from '../prisma'
import { gateVideoScript, HISTORY_PROFILE } from '../compliance'
import { discoverTopic } from './topicDiscovery'
import { generateHistoryScript } from './script'
import { resolveBeatFootage } from '../truecrime/footage'
import { sourceVisuals } from '../truecrime/visuals'
import { synthesizeNarration } from '../truecrime/tts'
import { generateCaptions } from '../truecrime/captions'
import { assembleVideo } from '../truecrime/assemble'
import { maybeAutoPublish } from '../tools/publish'
import { MAX_STAGE_ATTEMPTS, backoffMs, sleep } from '../retry'
import {
  isEmptyRender,
  isSilentVoiceover,
  resolveFinalStatus,
  EMPTY_RENDER_ERROR,
  SILENT_VOICEOVER_REASON,
} from '../pipeline/finalize'
import type { F11Context, F11FactoryConfig, F11Stage } from './types'

/**
 * Execute one F11 History/Business run. Mirrors executeTrueCrimeRun: create the
 * AgentRun + Video, drive each stage (recorded as a Job for the queue UI), then
 * land the video at a status that reflects the COMPLIANCE GATE decision —
 *   block           → "rejected" (and we skip the expensive TTS/render)
 *   route_to_review → "review"
 *   pass            → "approved" (auto agents) / "review" (review agents)
 */
export async function executeHistoryRun(
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

  const ctx: F11Context = {
    videoId: video.id,
    agentId,
    runId: run.id,
    config: JSON.parse(agent.factory.config || '{}') as F11FactoryConfig,
    playbook: agent.playbook,
  }

  try {
    await stage(ctx, 'discover', async () => {
      ctx.brief = await discoverTopic(ctx.config)
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
      ctx.script = await generateHistoryScript(ctx.videoId, ctx.playbook, ctx.brief!, ctx.config)
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
            provider: 'f11-beats',
            meta: JSON.stringify({ hook: ctx.script.hook, beats: ctx.script.beats }),
          },
        })
      }
    })

    // Per-beat footage ladder (AI still → stock → archive → mood bank), reused
    // from F10. Purely additive: with footage disabled or zero keys it returns
    // nothing and the visuals stage below sources everything from Wikimedia.
    await stage(ctx, 'footage', async () => {
      const footage = await resolveBeatFootage(ctx.videoId, ctx.script!, ctx.brief!, ctx.config)
      ctx.visuals = footage.visuals
      ctx.imagePaths = footage.imagePaths
      ctx.beatFootage = footage.beatFootage
      for (let i = 0; i < footage.visuals.length; i++) {
        await prisma.asset.create({
          data: {
            videoId: ctx.videoId,
            kind: 'image',
            provider: footage.imageSources[i] ?? 'footage',
            localPath: footage.imagePaths[i],
            meta: JSON.stringify({ ...footage.visuals[i], beatIndex: footage.visuals[i].beatIndex }),
          },
        })
      }
      // Audit row: which tier won each beat (for the queue UI / provenance log).
      if (Object.keys(footage.footageSources).length) {
        await prisma.asset.create({
          data: {
            videoId: ctx.videoId,
            kind: 'footage-map',
            provider: 'f11-footage',
            meta: JSON.stringify({
              footageSources: footage.footageSources,
              beatFootage: footage.beatFootage,
            }),
          },
        })
      }
    })

    // Visuals stage — the guaranteed BACKFILL floor. Tops up any shortfall
    // left by the footage stage with the keyless Wikimedia path, then hands the
    // MERGED asset list to the compliance gate so every asset gets linted.
    await stage(ctx, 'visuals', async () => {
      const seedVisuals = ctx.visuals ?? []
      const seedPaths = ctx.imagePaths ?? []
      const cap = ctx.config.maxImages ?? 6
      const backfillCount = Math.max(0, cap - seedPaths.length)

      let mergedVisuals = [...seedVisuals]
      let mergedPaths = [...seedPaths]
      if (backfillCount > 0) {
        const { visuals, imagePaths } = await sourceVisuals(ctx.videoId, ctx.brief!, backfillCount)
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
        mergedVisuals = [...mergedVisuals, ...visuals]
        mergedPaths = [...mergedPaths, ...imagePaths]
      }

      ctx.visuals = mergedVisuals
      ctx.imagePaths = mergedPaths
      ctx.script!.visuals = mergedVisuals // gate lints the full merged imagery
    })

    // ── Compliance gate — the decision point (F11 history/business profile) ──
    await stage(ctx, 'compliance', async () => {
      const { report } = await gateVideoScript(ctx.script!, {
        videoId: ctx.videoId,
        generatedAt: new Date().toISOString(),
        profile: HISTORY_PROFILE,
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
      ctx.tts = await synthesizeNarration(
        ctx.videoId,
        ctx.script!.narration,
        ctx.config.voice,
        'history'
      )
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
        ctx.tts!.words,
        ctx.tts!.segments
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
        ctx.captions!,
        { beats: ctx.script?.beats, beatFootage: ctx.beatFootage }
      )
      // Fail loud: an empty render must never be marked done or published.
      // Throwing lets stage() retry, then the run is marked failed with a
      // visible reason — mirroring the sports pipeline (tools/assemble.ts).
      if (isEmptyRender(ctx.render)) throw new Error(EMPTY_RENDER_ERROR)
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

    // A silent-stub voiceover (all voice providers failed) is a soft failure:
    // keep the video but hold it for review and never auto-publish a silent clip.
    const silentVoiceover = isSilentVoiceover(ctx.tts?.provider)
    if (silentVoiceover) {
      await prisma.job.create({
        data: {
          videoId: ctx.videoId,
          stage: 'voiceover',
          status: 'failed',
          attempts: 1,
          error: SILENT_VOICEOVER_REASON,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      })
    }

    const finalStatus = resolveFinalStatus({
      complianceDecision: ctx.complianceDecision,
      autonomy: agent.autonomy,
      silentVoiceover,
    })
    await prisma.video.update({ where: { id: ctx.videoId }, data: { status: finalStatus } })

    // Auto-publish only a clean compliance 'pass' with real audio for auto
    // agents (a 'route_to_review' decision or a silent voiceover already forced
    // finalStatus to 'review').
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

async function stage(ctx: F11Context, name: F11Stage, fn: () => Promise<void>): Promise<void> {
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
