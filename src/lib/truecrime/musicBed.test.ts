// Unit tests for the pure music-bed envelope math (src/lib/truecrime/musicBed.ts).
// These lock the invariants the bed relies on: gains rise with musicIntensity,
// never exceed the ceiling (so the narration always stays dominant), the curve
// aligns with the beats' seconds, and the emitted ffmpeg expression evaluates to
// the SAME numbers as gainAtSec (so the ffmpeg and Remotion beds stay in lockstep).

import { describe, expect, it } from 'vitest'
import {
  buildBedSynthArgs,
  buildMixFilter,
  buildMusicEnvelope,
  gainAtSec,
  mapIntensityToGain,
  toFfmpegVolumeExpr,
  MAX_MUSIC_GAIN,
  MIN_MUSIC_GAIN,
} from './musicBed'
import type { ScriptBeat } from './types'

function makeBeat(overrides: Partial<ScriptBeat> = {}): ScriptBeat {
  return {
    name: 'beat',
    index: 0,
    narration: '',
    targetSeconds: 10,
    visualCue: '',
    cutIntervalSec: 0,
    musicIntensity: 0.3,
    complianceFlag: 'factual',
    ...overrides,
  }
}

/** Evaluate the ffmpeg `volume` expression in plain JS to prove parity with
 *  gainAtSec. Only the tokens toFfmpegVolumeExpr emits (if/lt/t/arithmetic). */
function evalFfmpegExpr(expr: string, t: number): number {
  const js = expr
    .replace(/\bif\(/g, 'IF(')
    .replace(/\blt\(([^,]+),([^)]+)\)/g, '($1 < $2)')
    .replace(/\bt\b/g, String(t))
  const IF = (c: boolean, a: number, b: number) => (c ? a : b)
  // eslint-disable-next-line no-new-func
  return Function('IF', `return ${js};`)(IF)
}

describe('mapIntensityToGain', () => {
  it('maps the calm floor and climax peak to the gain bounds', () => {
    expect(mapIntensityToGain(0.3)).toBeCloseTo(MIN_MUSIC_GAIN, 6)
    expect(mapIntensityToGain(0.95)).toBeCloseTo(MAX_MUSIC_GAIN, 6)
  })

  it('is monotonic increasing in intensity', () => {
    expect(mapIntensityToGain(0.45)).toBeGreaterThan(mapIntensityToGain(0.3))
    expect(mapIntensityToGain(0.7)).toBeGreaterThan(mapIntensityToGain(0.45))
    expect(mapIntensityToGain(0.95)).toBeGreaterThan(mapIntensityToGain(0.7))
  })

  it('clamps out-of-range intensity to the bounds (never exceeds the ceiling)', () => {
    expect(mapIntensityToGain(-1)).toBeCloseTo(MIN_MUSIC_GAIN, 6)
    expect(mapIntensityToGain(0)).toBeCloseTo(MIN_MUSIC_GAIN, 6)
    expect(mapIntensityToGain(5)).toBeCloseTo(MAX_MUSIC_GAIN, 6)
  })
})

describe('buildMusicEnvelope', () => {
  it('returns a single flat floor point when there are no beats', () => {
    const env = buildMusicEnvelope([], 60)
    expect(env.points).toEqual([{ atSec: 0, gain: MIN_MUSIC_GAIN }])
    expect(env.totalSec).toBe(60)
  })

  it('returns a flat floor point for a non-positive duration', () => {
    const env = buildMusicEnvelope([makeBeat()], 0)
    expect(env.points).toEqual([{ atSec: 0, gain: MIN_MUSIC_GAIN }])
  })

  it('places a breakpoint per beat, starting at 0 and holding to totalSec', () => {
    const beats = [
      makeBeat({ index: 0, musicIntensity: 0.3, targetSeconds: 4 }),
      makeBeat({ index: 1, musicIntensity: 0.6, targetSeconds: 8 }),
      makeBeat({ index: 2, musicIntensity: 0.95, targetSeconds: 8 }),
    ]
    const env = buildMusicEnvelope(beats, 40)
    // one point per beat + a terminal hold point
    expect(env.points).toHaveLength(4)
    expect(env.points[0].atSec).toBe(0)
    expect(env.points[env.points.length - 1].atSec).toBeCloseTo(40, 6)
    // times are monotonic non-decreasing and never past totalSec
    for (let i = 1; i < env.points.length; i++) {
      expect(env.points[i].atSec).toBeGreaterThanOrEqual(env.points[i - 1].atSec)
      expect(env.points[i].atSec).toBeLessThanOrEqual(40 + 1e-6)
    }
  })

  it('scales beat start times by targetSeconds weights (voice-sync)', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 4 }),
      makeBeat({ index: 1, targetSeconds: 8 }),
      makeBeat({ index: 2, targetSeconds: 8 }),
    ]
    const env = buildMusicEnvelope(beats, 40)
    // weights 4/8/8 (sum 20) over 40s → beats start at 0, 8, 24
    expect(env.points[0].atSec).toBeCloseTo(0, 6)
    expect(env.points[1].atSec).toBeCloseTo(8, 6)
    expect(env.points[2].atSec).toBeCloseTo(24, 6)
  })

  it('gives the climax beat the loudest gain and never exceeds the ceiling', () => {
    const beats = [
      makeBeat({ index: 0, musicIntensity: 0.3 }),
      makeBeat({ index: 1, musicIntensity: 0.95 }),
    ]
    const env = buildMusicEnvelope(beats, 30)
    const gains = env.points.map((p) => p.gain)
    expect(Math.max(...gains)).toBeCloseTo(MAX_MUSIC_GAIN, 6)
    for (const g of gains) expect(g).toBeLessThanOrEqual(MAX_MUSIC_GAIN + 1e-9)
  })
})

describe('gainAtSec', () => {
  const env = buildMusicEnvelope(
    [
      makeBeat({ index: 0, musicIntensity: 0.3, targetSeconds: 10 }),
      makeBeat({ index: 1, musicIntensity: 0.95, targetSeconds: 10 }),
    ],
    20
  )

  it('returns exact gains at breakpoints', () => {
    expect(gainAtSec(env, 0)).toBeCloseTo(env.points[0].gain, 6)
    expect(gainAtSec(env, 10)).toBeCloseTo(env.points[1].gain, 6)
  })

  it('linearly interpolates between breakpoints', () => {
    const mid = gainAtSec(env, 5)
    const expected = (env.points[0].gain + env.points[1].gain) / 2
    expect(mid).toBeCloseTo(expected, 6)
  })

  it('clamps before the first and after the last point', () => {
    expect(gainAtSec(env, -5)).toBeCloseTo(env.points[0].gain, 6)
    expect(gainAtSec(env, 999)).toBeCloseTo(env.points[env.points.length - 1].gain, 6)
  })
})

describe('toFfmpegVolumeExpr', () => {
  it('collapses a single-point envelope to a constant', () => {
    const env = buildMusicEnvelope([], 60)
    const expr = toFfmpegVolumeExpr(env)
    expect(expr).toBe(MIN_MUSIC_GAIN.toFixed(4))
    expect(evalFfmpegExpr(expr, 12)).toBeCloseTo(MIN_MUSIC_GAIN, 6)
  })

  it('evaluates to the SAME values as gainAtSec across the timeline', () => {
    const env = buildMusicEnvelope(
      [
        makeBeat({ index: 0, musicIntensity: 0.3, targetSeconds: 4 }),
        makeBeat({ index: 1, musicIntensity: 0.6, targetSeconds: 8 }),
        makeBeat({ index: 2, musicIntensity: 0.95, targetSeconds: 6 }),
        makeBeat({ index: 3, musicIntensity: 0.5, targetSeconds: 6 }),
      ],
      36
    )
    const expr = toFfmpegVolumeExpr(env)
    for (const t of [0, 1, 4, 7.5, 12, 18, 24, 30, 35.9]) {
      expect(evalFfmpegExpr(expr, t)).toBeCloseTo(gainAtSec(env, t), 4)
    }
  })
})

describe('buildBedSynthArgs', () => {
  it('builds a bounded, self-contained ffmpeg synthesis command', () => {
    const args = buildBedSynthArgs(42, '/tmp/x/music-bed.wav')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('/tmp/x/music-bed.wav')
    // three lavfi sine sources, each length-bounded so the bed can't outrun audio
    expect(args.filter((a) => a === 'lavfi')).toHaveLength(3)
    expect(args.filter((a) => a === '42.0000')).not.toHaveLength(0)
    expect(args[args.length - 1]).toBe('/tmp/x/music-bed.wav')
  })
})

describe('buildMixFilter', () => {
  it('mixes narration + bed with eval=frame automation and no normalisation', () => {
    const env = buildMusicEnvelope([makeBeat({ musicIntensity: 0.6 })], 20)
    const filter = buildMixFilter(env)
    expect(filter).toContain('eval=frame') // else the automation is silently flat
    expect(filter).toContain('normalize=0') // else amix halves the narration
    expect(filter).toContain('duration=first')
    expect(filter).toContain('[aout]')
  })
})
