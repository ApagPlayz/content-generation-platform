// Background-music bed for the F10 true-crime + F11 history factories. Until now
// the narration played over SILENCE: the script stage already computes a per-beat
// `musicIntensity` curve (calm 0.3 → 0.95 at the climax) but nothing ever laid a
// music track under the voice. This module is the single, seconds-based source of
// truth that BOTH render engines consume so the bed swells identically:
//   • ffmpeg   (assemble.ts) synthesises the bed, then pre-mixes it UNDER the
//     narration using the `volume` filter driven by this envelope,
//   • Remotion (TrueCrime.tsx) plays the same bed file with a `volume` callback
//     that reads the same envelope points.
//
// The bed is 100% SYNTHESISED by ffmpeg's own oscillators — an original ambient
// drone — so it is monetization-safe by construction (no third-party audio, no
// network, no committed binary) and mixed well under the voice so narration
// always stays clearly dominant.
//
// Pure module (except the two ffmpeg-arg BUILDERS, which only assemble strings —
// they never shell out): no I/O, no Prisma, no ffmpeg. Safe to unit test.

import type { ScriptBeat } from './types'

/** One breakpoint of the music-gain automation. `gain` is a LINEAR amplitude
 *  multiplier (not dB), already capped so the narration stays dominant. */
export interface MusicEnvelopePoint {
  atSec: number
  gain: number
}

export interface MusicEnvelope {
  /** Sorted by `atSec`; first point at 0, last point at `totalSec`. */
  points: MusicEnvelopePoint[]
  totalSec: number
}

/** Linear-gain floor mapped to the calmest beat (musicIntensity ≤ 0.3) and the
 *  ceiling mapped to the climax (≥ 0.95). ~0.08 → -22 dBFS, ~0.18 → -15 dBFS:
 *  the bed sits well under a ~0 dBFS narration so the voice is never masked. */
export const MIN_MUSIC_GAIN = 0.08
export const MAX_MUSIC_GAIN = 0.18

/** The intensity band the curve spans (see the beat tables in script.ts). */
const CALM_INTENSITY = 0.3
const PEAK_INTENSITY = 0.95

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Map a beat's `musicIntensity` (nominally 0.3 → 0.95) to a capped LINEAR gain
 *  in [minGain, maxGain]. Out-of-range intensity clamps to the ends, so the bed
 *  can never exceed the ceiling (voice-dominance guarantee) or hit true silence. */
export function mapIntensityToGain(
  intensity: number,
  minGain = MIN_MUSIC_GAIN,
  maxGain = MAX_MUSIC_GAIN
): number {
  const span = PEAK_INTENSITY - CALM_INTENSITY || 1
  const t = clamp((intensity - CALM_INTENSITY) / span, 0, 1)
  return minGain + t * (maxGain - minGain)
}

/**
 * Build the volume envelope from the script's beats. Each beat contributes a
 * breakpoint at its START time carrying `mapIntensityToGain(beat.musicIntensity)`;
 * the linear ramp between breakpoints is the swell. `targetSeconds` become
 * weights that are rescaled to sum EXACTLY to `totalSec` — the SAME voice-sync
 * trick `buildBeatTimeline` uses — so the crescendo lines up with the cuts and
 * the narration rather than drifting. A final point at `totalSec` holds the last
 * beat's gain to the end.
 *
 * Degenerate input (no beats, or totalSec ≤ 0) → a single flat point at the
 * floor, which the callers treat as "no meaningful curve".
 */
export function buildMusicEnvelope(
  beats: ScriptBeat[] | undefined,
  totalSec: number,
  minGain = MIN_MUSIC_GAIN,
  maxGain = MAX_MUSIC_GAIN
): MusicEnvelope {
  const total = totalSec > 0 ? totalSec : 0
  const ordered = [...(beats ?? [])].sort((a, b) => a.index - b.index)
  if (ordered.length === 0 || total === 0) {
    return { points: [{ atSec: 0, gain: minGain }], totalSec: total }
  }

  const weights = ordered.map((b) => (b.targetSeconds > 0 ? b.targetSeconds : 1))
  const weightSum = weights.reduce((a, b) => a + b, 0) || ordered.length

  const points: MusicEnvelopePoint[] = []
  let cursor = 0
  let lastGain = minGain
  for (let i = 0; i < ordered.length; i++) {
    lastGain = mapIntensityToGain(ordered[i].musicIntensity, minGain, maxGain)
    points.push({ atSec: cursor, gain: lastGain })
    cursor += (weights[i] / weightSum) * total
  }
  // Hold the final gain out to the exact end so the ramp never runs short.
  points.push({ atSec: total, gain: lastGain })
  return { points, totalSec: total }
}

/** Piecewise-linear read of the envelope at an absolute second. Clamps before
 *  the first / after the last point (no extrapolation). This is the exact math
 *  the Remotion `<Audio volume>` callback and the ffmpeg expression both use. */
export function gainAtSec(env: MusicEnvelope, sec: number): number {
  const pts = env.points
  if (pts.length === 0) return 0
  if (sec <= pts[0].atSec) return pts[0].gain
  const last = pts[pts.length - 1]
  if (sec >= last.atSec) return last.gain
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (sec >= a.atSec && sec < b.atSec) {
      const width = b.atSec - a.atSec
      if (width <= 0) return b.gain
      const frac = (sec - a.atSec) / width
      return a.gain + frac * (b.gain - a.gain)
    }
  }
  return last.gain
}

/** Fixed-decimal formatting keeps the emitted ffmpeg expression deterministic
 *  (and locale-independent), so it is stable to unit test. */
function fmt(n: number): string {
  return n.toFixed(4)
}

/**
 * Render the envelope as an ffmpeg `volume` filter expression over `t` (seconds).
 * A nested if/lerp that reproduces `gainAtSec` exactly. MUST be applied with
 * `eval=frame`, otherwise ffmpeg evaluates `t` once and the automation is
 * silently flat. A single-point envelope collapses to a constant.
 */
export function toFfmpegVolumeExpr(env: MusicEnvelope): string {
  const pts = env.points
  if (pts.length <= 1) return fmt(pts[0]?.gain ?? 0)

  // Build from the last segment inward so the nesting reads left-to-right.
  let expr = fmt(pts[pts.length - 1].gain) // gain held after the final point
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]
    const b = pts[i + 1]
    const width = b.atSec - a.atSec
    const seg =
      width <= 0
        ? fmt(b.gain)
        : `(${fmt(a.gain)}+(t-${fmt(a.atSec)})/${fmt(width)}*${fmt(b.gain - a.gain)})`
    // Below b.atSec we are inside segment i; at/after it, fall through to `expr`.
    expr = `if(lt(t,${fmt(b.atSec)}),${seg},${expr})`
  }
  return expr
}

/**
 * ffmpeg argv (for `execFile('ffmpeg', …)`) that SYNTHESISES an original ambient
 * music bed of `totalSec` into `outPath`. An open-fifth drone (A1/A2/E3) given a
 * slow tremolo "breath" and low-passed so its energy sits below the voice band;
 * short fades baked into both ends so the bed eases in and out. No level
 * automation here — the per-beat swell is applied at MIX time via
 * `toFfmpegVolumeExpr`, so this one recipe serves both render engines identically.
 */
export function buildBedSynthArgs(totalSec: number, outPath: string): string[] {
  const d = totalSec > 0 ? totalSec : 1
  const fadeOutStart = Math.max(0, d - 3)
  const sine = (freq: number) =>
    ['-f', 'lavfi', '-t', fmt(d), '-i', `sine=frequency=${freq}:sample_rate=48000`]
  return [
    '-y',
    ...sine(55), // A1
    ...sine(110), // A2
    ...sine(164.81), // E3 — open fifth, moody but consonant
    '-filter_complex',
    `[0:a][1:a][2:a]amix=inputs=3:normalize=1,` +
      // tremolo `f` floors at 0.1 Hz in ffmpeg — a ~10s "breath" is the slowest allowed.
      `tremolo=f=0.1:d=0.3,lowpass=f=600,` +
      `afade=t=in:st=0:d=2,afade=t=out:st=${fmt(fadeOutStart)}:d=3,` +
      `aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[bed]`,
    '-map',
    '[bed]',
    '-t',
    fmt(d),
    '-c:a',
    'pcm_s16le',
    outPath,
  ]
}

/**
 * The ffmpeg `-filter_complex` string that mixes narration (input 0) with the
 * synthesised bed (input 1), the bed level automated by the envelope. `normalize=0`
 * is essential — amix's default averaging would halve the narration; `duration=first`
 * ties the output length to the voice. Output label is `[aout]`.
 */
export function buildMixFilter(env: MusicEnvelope): string {
  return (
    `[1:a]volume='${toFfmpegVolumeExpr(env)}':eval=frame[mbed];` +
    `[0:a][mbed]amix=inputs=2:duration=first:normalize=0[aout]`
  )
}
