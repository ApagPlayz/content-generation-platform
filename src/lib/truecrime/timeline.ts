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
 * EXACTLY — the voice-sync guarantee. Within a beat the runtime is sliced by
 * `cutIntervalSec` (falling back to one slice per resolved clip) and slices are
 * assigned to the beat's clips round-robin; when the same video clip is reused
 * its `inSec` advances so it plays through rather than replaying the same trim.
 *
 * Returns [] when there is no usable footage — the caller then degrades to its
 * existing even-split slideshow, so nothing breaks when the footage ladder is
 * off or returned nothing.
 */
export function buildBeatTimeline(
  beats: ScriptBeat[],
  beatFootage: Record<number, string[]>,
  audioDurationSec: number
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

    // Slice the beat by cutIntervalSec; at least one slice per resolved clip so
    // every clip is shown, at least one slice overall.
    const cut = beat.cutIntervalSec > 0 ? beat.cutIntervalSec : beatDur
    let nSlices = Math.round(beatDur / cut)
    if (!Number.isFinite(nSlices)) nSlices = clips.length
    nSlices = Math.max(clips.length, nSlices, 1)

    // Track how far we've already trimmed into each reused video clip.
    const advance: Record<number, number> = {}
    let beatCursor = 0
    for (let s = 0; s < nSlices; s++) {
      const sliceDur = s === nSlices - 1 ? beatDur - beatCursor : beatDur / nSlices
      if (sliceDur <= 0) continue
      const clipIdx = s % clips.length
      const assetPath = clips[clipIdx]
      const kind: TimelineSegment['kind'] = isImageAsset(assetPath) ? 'image' : 'video'
      const seg: TimelineSegment = {
        beatIndex: beat.index,
        startSec: cursor + beatCursor,
        durationSec: sliceDur,
        assetPath,
        kind,
      }
      if (kind === 'video') {
        seg.inSec = advance[clipIdx] ?? 0
        advance[clipIdx] = seg.inSec + sliceDur
      }
      segments.push(seg)
      beatCursor += sliceDur
    }

    cursor += beatDur
  }

  return segments
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
