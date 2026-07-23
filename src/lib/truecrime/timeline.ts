// Shared beat timeline for the F10 assemble stage. This is the single,
// seconds-based source of truth that BOTH render engines consume so their cut
// timing stays identical and neither drifts against the narration audio:
//   • ffmpeg  (assemble.ts, 25 fps) renders one clip per segment then concats,
//   • Remotion (remotion.ts, 30 fps) maps each segment to a <Sequence>.
// Because the durations are in seconds and are rescaled to sum EXACTLY to the
// narration length, each engine converts to frames locally at its own fps
// without the cuts sliding out of sync with the voice.
//
// Pure module: no I/O, no Prisma, no ffmpeg — safe to unit test.

import type { ScriptBeat, TimelineSegment } from './types'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'])

/**
 * Minimum on-screen hold for a STILL image (round 6 — "scenes changing every
 * half a second"). Stills used to be sliced by the beat's cutIntervalSec and
 * round-robined, so a 15.4s beat with cutIntervalSec 1.2 showed its 2 stills
 * 13 times at 1.18s each. A still now holds ≥ this long and is shown AT MOST
 * ONCE per beat — when a beat has more stills than fit, the extras are dropped
 * (fewer images with longer holds beat rapid repeats). Video clips keep their
 * cutIntervalSec pacing: a moving shot can sustain fast cuts, a static photo
 * cannot.
 */
export const MIN_IMAGE_HOLD_SEC = 5

/**
 * Hard cap (seconds) on any single moving clip's on-screen time. A relevant
 * fair-use / archival excerpt is shown ONCE for a calm, capped hold — never
 * looped, rapid-cut, or dragged past this — then the beat cuts to a photo. This
 * is a genre convention AND a fair-use safety rail (short excerpts only): it is
 * enforced in code, never a suggestion, and never exceeds 10s.
 */
export const MAX_CLIP_ONSCREEN_SEC = 8

/** Infer whether a resolved asset is a still image (Ken-Burns) or a video clip. */
function isImageAsset(assetPath: string): boolean {
  const dot = assetPath.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(assetPath.slice(dot).toLowerCase())
}

/**
 * Build the ordered per-beat timeline from the script's beats and the footage
 * resolved for each beat (keyed by beat index). Only beats that actually have
 * resolved footage contribute segments; their `targetSeconds` become weights
 * that are proportionally rescaled so the timeline sums to `audioDurationSec`
 * EXACTLY — the voice-sync guarantee. Within an all-STILL beat each image is
 * shown at most once and holds ≥ MIN_IMAGE_HOLD_SEC (see the constant's note);
 * beats containing video are sliced by `cutIntervalSec` (falling back to one
 * slice per resolved clip) with slices assigned round-robin; when the same
 * video clip is reused its `inSec` advances so it plays through rather than
 * replaying the same trim.
 *
 * Returns [] when there is no usable footage — the caller then degrades to its
 * existing even-split slideshow, so nothing breaks when the footage ladder is
 * off or returned nothing.
 */
export function buildBeatTimeline(
  beats: ScriptBeat[],
  beatFootage: Record<number, string[]>,
  audioDurationSec: number,
  maxClipSec: number = MAX_CLIP_ONSCREEN_SEC
): TimelineSegment[] {
  const total = Math.max(0.1, audioDurationSec)

  // Beats with at least one resolved asset, in index order.
  const ordered = [...beats]
    .sort((a, b) => a.index - b.index)
    .map((beat) => ({ beat, clips: (beatFootage[beat.index] ?? []).filter(Boolean) }))
    .filter((e) => e.clips.length > 0)

  if (ordered.length === 0) return []

  // Proportional weights from targetSeconds (equal weight when unset).
  const weights = ordered.map((e) => (e.beat.targetSeconds > 0 ? e.beat.targetSeconds : 1))
  const weightSum = weights.reduce((a, b) => a + b, 0) || ordered.length

  const segments: TimelineSegment[] = []
  let cursor = 0 // running start of the current beat (seconds)

  for (let i = 0; i < ordered.length; i++) {
    const { beat, clips } = ordered[i]
    // Last beat absorbs all accumulated rounding so the timeline ends EXACTLY
    // at audioDurationSec.
    const beatDur = i === ordered.length - 1 ? total - cursor : (weights[i] / weightSum) * total
    if (beatDur <= 0) {
      cursor = total
      continue
    }

    // Split the beat's resolved assets into moving clips and stills.
    const videos = clips.filter((c) => !isImageAsset(c))
    const stills = clips.filter((c) => isImageAsset(c))

    // Build the ordered "cells" for this beat, each with a target duration.
    const cells: { assetPath: string; kind: TimelineSegment['kind']; dur: number }[] = []

    if (videos.length === 0) {
      // ALL-STILL beat (round 6 calm cadence): each still shown AT MOST once,
      // held ≥ MIN_IMAGE_HOLD_SEC (a single still absorbs a short beat). Extras
      // beyond what the beat can hold calmly are DROPPED — never repeated/rushed.
      const maxByHold = Math.max(1, Math.floor(beatDur / MIN_IMAGE_HOLD_SEC))
      const use = stills.slice(0, Math.min(stills.length, maxByHold))
      const per = beatDur / use.length
      for (const s of use) cells.push({ assetPath: s, kind: 'image', dur: per })
    } else {
      // MIXED / VIDEO beat (2026-07 relevant-clip layer): a real moving excerpt
      // is shown ONCE for a CAPPED, calm hold (≤ maxClipSec), then the beat cuts
      // to the beat's photo(s) for the remainder — no looping, no rapid cutting,
      // and never a clip dragged past the fair-use on-screen cap. buildMixed-
      // BeatFootage always attaches a photo to a clip-beat, so a long beat's
      // leftover after the capped clip lands on a photo, not a stretched clip.
      const cap = maxClipSec > 0 ? maxClipSec : beatDur
      // Total time the clip(s) may hold — each capped, summed, never past the
      // beat. Whatever's left is the still budget.
      let clipTime = Math.min(beatDur, videos.length * Math.min(cap, beatDur))
      let stillTime = beatDur - clipTime
      let nStills = Math.min(stills.length, Math.floor(stillTime / MIN_IMAGE_HOLD_SEC))
      // If a single capped clip leaves a remainder too small for a photo's min
      // hold, SHRINK the clip so one photo still gets its hold — better than
      // dropping the photo and letting the clip overrun its cap.
      if (nStills === 0 && stills.length > 0 && videos.length === 1 && beatDur > MIN_IMAGE_HOLD_SEC) {
        nStills = 1
        stillTime = MIN_IMAGE_HOLD_SEC
        clipTime = beatDur - stillTime
      }
      // No photos to show at all → the clip(s) absorb the whole beat (the only
      // path that can extend a clip past the cap; buildMixedBeatFootage always
      // attaches a photo, so the normal path never reaches it).
      if (nStills === 0) {
        clipTime = beatDur
        stillTime = 0
      }
      const perVideo = clipTime / videos.length
      for (const v of videos) cells.push({ assetPath: v, kind: 'video', dur: perVideo })
      if (nStills > 0) {
        const use = stills.slice(0, nStills)
        const perStill = stillTime / use.length
        for (const s of use) cells.push({ assetPath: s, kind: 'image', dur: perStill })
      }
    }

    // Emit the cells as segments; the last cell absorbs float drift so the beat
    // sums EXACTLY to beatDur. A single capped clip always trims from its start
    // (inSec 0) — the download step already picked a meaningful in-point.
    let beatCursor = 0
    for (let c = 0; c < cells.length; c++) {
      const dur = c === cells.length - 1 ? beatDur - beatCursor : cells[c].dur
      if (dur <= 0) continue
      const seg: TimelineSegment = {
        beatIndex: beat.index,
        startSec: cursor + beatCursor,
        durationSec: dur,
        assetPath: cells[c].assetPath,
        kind: cells[c].kind,
      }
      if (cells[c].kind === 'video') seg.inSec = 0
      segments.push(seg)
      beatCursor += dur
    }

    cursor += beatDur
  }

  return segments
}

/**
 * Merge the resolved moving clips with the photo backbone into a single
 * per-beat footage map the render timeline consumes. Photos (the majority) are
 * distributed round-robin across every beat in index order so each beat gets a
 * fair share; a beat that also has a clip lists the CLIP FIRST (shown for its
 * capped hold) then its photo(s) (which fill the rest of the beat). The result
 * is a genuine mix — clips where a relevant one exists, photos everywhere — and
 * because a clip-beat always carries a photo, buildBeatTimeline never has to
 * stretch a clip past its on-screen cap. Pure; exported for tests.
 */
export function buildMixedBeatFootage(
  beats: ScriptBeat[],
  clipsByBeat: Record<number, string[]>,
  photoPaths: string[]
): Record<number, string[]> {
  const ordered = [...beats].sort((a, b) => a.index - b.index)
  const photos = photoPaths.filter(Boolean)
  const n = ordered.length

  // Prioritise clip-beats when handing out photos so every clip-beat is
  // guaranteed a photo to fill the time after its capped clip, THEN top up the
  // remaining beats round-robin. Order within a beat is preserved.
  const photosByBeat: Record<number, string[]> = {}
  if (n > 0 && photos.length > 0) {
    const clipBeatIdx = ordered.filter((b) => (clipsByBeat[b.index] ?? []).some(Boolean)).map((b) => b.index)
    const restIdx = ordered.filter((b) => !clipBeatIdx.includes(b.index)).map((b) => b.index)
    const roundRobin = [...clipBeatIdx, ...restIdx]
    if (roundRobin.length > 0) {
      photos.forEach((p, i) => {
        const idx = roundRobin[i % roundRobin.length]
        ;(photosByBeat[idx] ??= []).push(p)
      })
    }
  }

  const result: Record<number, string[]> = {}
  for (const beat of ordered) {
    const clips = (clipsByBeat[beat.index] ?? []).filter(Boolean)
    const beatPhotos = photosByBeat[beat.index] ?? []
    const merged = [...clips, ...beatPhotos]
    if (merged.length > 0) result[beat.index] = merged
  }
  return result
}

/** A segment mapped to an integer frame window on a given fps grid. */
export interface FrameSpan {
  startFrame: number
  durationInFrames: number
}

/**
 * Convert seconds-based segments to integer frame windows at `fps`, rounding
 * the RUNNING cumulative total (not each piece independently) so per-clip
 * rounding never accumulates into cut-vs-audio drift over a 60–90s video. Each
 * segment starts exactly where the previous one ended, and the final frame
 * lands on round(totalSeconds * fps).
 */
export function toCumulativeFrames(segments: TimelineSegment[], fps: number): FrameSpan[] {
  const spans: FrameSpan[] = []
  let cumSec = 0
  let prevEndFrame = 0
  for (const seg of segments) {
    cumSec += seg.durationSec
    const endFrame = Math.round(cumSec * fps)
    const startFrame = prevEndFrame
    const durationInFrames = Math.max(1, endFrame - startFrame)
    spans.push({ startFrame, durationInFrames })
    prevEndFrame = startFrame + durationInFrames
  }
  return spans
}
