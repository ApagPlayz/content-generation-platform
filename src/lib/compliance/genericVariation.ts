// Anti-repetition gate for the generic sports/reddit pipeline (issue #17).
//
// The True Crime (F10) and History (F11) pipelines already run a template-
// similarity brake via the compliance gate (variation.ts). The generic
// orchestrator did not — so it could mass-produce a wall of near-identical
// uploads, which is exactly what YouTube's "inauthentic / mass-produced content"
// policy demonetizes (and has terminated channels for).
//
// The generic ScriptResult has none of TrueCrimeScript's narration /
// ScriptStructure / VisualAsset[], so we compare the signals that actually
// exist for a sports/reddit short:
//   1. title + hook overlap  → the same opening line stamped out again
//   2. the source highlight reel → the exact same clip reused
// Both are soft signals: crossing either routes the video to review instead of
// auto-publishing, never a hard block. Reads live off the Video/HighlightSource
// rows (no new corpus table), and is best-effort — a DB hiccup never fails a run.
//
// The decision is a pure function (evaluateGenericVariation) so it is unit-tested
// without a database, mirroring this repo's colocated pure-helper test style.

import { prisma } from '../prisma'
import type { VariationVerdict } from './types'
import { shingles, jaccard } from './textSimilarity'

// Same bar the True Crime narration axis uses — an 80%+ overlap on the same
// short opening is "same template", not coincidence.
export const SIMILARITY_THRESHOLD = 0.8
const RECENT_WINDOW = 15

export interface GenericVariationInput {
  /** The video being checked — excluded from its own comparison corpus. */
  currentVideoId: string
  title?: string | null
  hook?: string | null
  /** Source highlight-reel URL this video was built from. Reusing the exact same
   *  clip as a recent video is the strongest "mass-produced" signal available. */
  sourceUrl?: string | null
}

/** A recent same-factory video, flattened for comparison. */
export interface PriorVideo {
  title?: string | null
  scriptText?: string | null
  sourceUrl?: string | null
}

/**
 * Normalise a source URL for exact-clip matching. yt-dlp stores the canonical
 * `webpage_url` (e.g. https://www.youtube.com/watch?v=VIDEOID), where the video
 * identity lives in the `?v=` query and is CASE-SENSITIVE — so we keep the query
 * and never lowercase (doing either would merge distinct reels into one). We only
 * trim and drop a trailing fragment / slash, which the reel identity never uses.
 */
export function normalizeUrl(u?: string | null): string {
  if (!u) return ''
  return u.trim().split('#')[0].replace(/\/+$/, '')
}

/**
 * Pure decision core: compare one candidate video against a factory's recent
 * output. Returns the same VariationVerdict shape the True Crime gate uses, so
 * callers can treat every factory uniformly.
 */
export function evaluateGenericVariation(
  input: { title?: string | null; hook?: string | null; sourceUrl?: string | null },
  priors: PriorVideo[]
): VariationVerdict {
  if (priors.length === 0) {
    return {
      passed: true,
      maxSimilarity: 0,
      visualSimilarity: 0,
      reasons: ['No prior videos from this factory to compare against.'],
    }
  }

  const myText = `${input.title ?? ''} ${input.hook ?? ''}`.trim()
  const mySource = normalizeUrl(input.sourceUrl)
  const myShingles = shingles(myText)

  let maxSim = 0
  let sameClip = false
  for (const p of priors) {
    // Text axis — only meaningful when this video actually has script text.
    if (myShingles.size > 0) {
      const priorText = `${p.title ?? ''} ${p.scriptText ?? ''}`.trim()
      const sim = jaccard(myShingles, shingles(priorText))
      if (sim > maxSim) maxSim = sim
    }
    // Same-clip axis — exact reuse of the source reel.
    const priorSource = normalizeUrl(p.sourceUrl)
    if (mySource && priorSource && mySource === priorSource) sameClip = true
  }

  const textPass = maxSim < SIMILARITY_THRESHOLD
  const passed = textPass && !sameClip

  const reasons: string[] = []
  if (!textPass) {
    reasons.push(
      `Title/hook is ${(maxSim * 100).toFixed(0)}% identical to a recent video — vary the ` +
        'opening to avoid YouTube\'s "mass-produced content" policy.'
    )
  }
  if (sameClip) {
    reasons.push(
      'Built from the exact same source clip as a recent video — use different footage ' +
        'to avoid the "inauthentic content" policy.'
    )
  }
  if (passed) {
    reasons.push(
      `Max title/hook overlap with recent videos: ${(maxSim * 100).toFixed(0)}% (under threshold); source clip is new.`
    )
  }

  return { passed, maxSimilarity: maxSim, visualSimilarity: sameClip ? 1 : 0, reasons }
}

/**
 * Load this factory's recent videos and run the pure check against them.
 * Best-effort: any DB error degrades to a pass so a good render is never lost.
 */
export async function checkGenericVariation(
  factoryId: string,
  input: GenericVariationInput,
  window = RECENT_WINDOW
): Promise<VariationVerdict> {
  let priors: PriorVideo[]
  try {
    const rows = await prisma.video.findMany({
      // Same factory only — comparing a sports short against a reddit one would
      // poison both corpora. Skip failed runs and this very video.
      where: { factoryId, id: { not: input.currentVideoId }, status: { not: 'failed' } },
      orderBy: { createdAt: 'desc' },
      take: window,
      select: {
        title: true,
        scriptText: true,
        highlightSources: { select: { youtubeUrl: true }, take: 1 },
      },
    })
    priors = rows.map((r) => ({
      title: r.title,
      scriptText: r.scriptText,
      sourceUrl: r.highlightSources[0]?.youtubeUrl ?? null,
    }))
  } catch {
    // DB not migrated / table missing — the check is best-effort, never a blocker.
    return {
      passed: true,
      maxSimilarity: 0,
      visualSimilarity: 0,
      reasons: ['Variation check skipped — could not read prior videos.'],
    }
  }

  return evaluateGenericVariation(input, priors)
}
