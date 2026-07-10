// Unit tests for the pure beat-timeline builder (src/lib/truecrime/timeline.ts).
// These are the platform's first automated tests: they lock down the
// voice-sync invariants documented at the top of timeline.ts — segments must
// sum EXACTLY to the narration length, and frame conversion must land on
// round(totalSeconds * fps) with no cumulative drift.

import { describe, expect, it } from 'vitest'
import { buildBeatTimeline, toCumulativeFrames } from './timeline'
import type { ScriptBeat, TimelineSegment } from './types'

function makeBeat(overrides: Partial<ScriptBeat> = {}): ScriptBeat {
  return {
    name: 'beat',
    index: 0,
    narration: '',
    targetSeconds: 10,
    visualCue: '',
    cutIntervalSec: 0,
    musicIntensity: 0,
    complianceFlag: 'factual',
    ...overrides,
  }
}

function sumDurations(segments: TimelineSegment[]): number {
  return segments.reduce((acc, s) => acc + s.durationSec, 0)
}

describe('buildBeatTimeline', () => {
  it('returns [] when there is no resolved footage for any beat', () => {
    const beats = [makeBeat({ index: 0 })]
    expect(buildBeatTimeline(beats, {}, 30)).toEqual([])
  })

  it('returns [] when beatFootage entries are present but empty/falsy', () => {
    const beats = [makeBeat({ index: 0 }), makeBeat({ index: 1 })]
    const beatFootage = { 0: [], 1: [undefined as unknown as string] }
    expect(buildBeatTimeline(beats, beatFootage, 30)).toEqual([])
  })

  it('single beat, single clip, no cutIntervalSec: one segment spanning the full duration', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 10, cutIntervalSec: 0 })]
    const beatFootage = { 0: ['still.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 12)

    expect(segments).toHaveLength(1)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].durationSec).toBeCloseTo(12, 9)
    expect(segments[0].kind).toBe('image')
    expect(segments[0].assetPath).toBe('still.jpg')
    // Images never carry an inSec trim.
    expect(segments[0].inSec).toBeUndefined()
  })

  it('segments sum EXACTLY to audioDurationSec for a many-beat, unevenly-weighted case', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 7 }),
      makeBeat({ index: 1, targetSeconds: 3 }),
      makeBeat({ index: 2, targetSeconds: 11 }),
      makeBeat({ index: 3, targetSeconds: 5 }),
    ]
    const beatFootage = {
      0: ['a.jpg'],
      1: ['b.jpg'],
      2: ['c.jpg', 'd.mp4'],
      3: ['e.jpg'],
    }
    const audioDurationSec = 47.3
    const segments = buildBeatTimeline(beats, beatFootage, audioDurationSec)

    expect(sumDurations(segments)).toBeCloseTo(audioDurationSec, 9)
  })

  it('equal-weight beats (unset targetSeconds) still sum exactly and split evenly', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 0 }),
      makeBeat({ index: 1, targetSeconds: 0 }),
      makeBeat({ index: 2, targetSeconds: 0 }),
    ]
    const beatFootage = { 0: ['a.jpg'], 1: ['b.jpg'], 2: ['c.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 10)

    expect(segments).toHaveLength(3)
    expect(sumDurations(segments)).toBeCloseTo(10, 9)
    // First two beats get exactly total/3; the last beat absorbs rounding.
    expect(segments[0].durationSec).toBeCloseTo(10 / 3, 9)
    expect(segments[1].durationSec).toBeCloseTo(10 / 3, 9)
  })

  it('skips beats with no resolved footage but keeps the rest, still summing exactly', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 5 }),
      makeBeat({ index: 1, targetSeconds: 5 }), // no footage — should be skipped
      makeBeat({ index: 2, targetSeconds: 5 }),
    ]
    const beatFootage = { 0: ['a.jpg'], 2: ['c.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 20)

    const beatIndexes = new Set(segments.map((s) => s.beatIndex))
    expect(beatIndexes.has(1)).toBe(false)
    expect(sumDurations(segments)).toBeCloseTo(20, 9)
  })

  it('reuses a single video clip across multiple slices and advances inSec each time', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 9, cutIntervalSec: 3 })]
    const beatFootage = { 0: ['clip.mp4'] }
    const segments = buildBeatTimeline(beats, beatFootage, 9)

    // beatDur=9, cutIntervalSec=3 -> nSlices = round(9/3) = 3, all from the one clip.
    expect(segments).toHaveLength(3)
    for (const s of segments) {
      expect(s.kind).toBe('video')
      expect(s.assetPath).toBe('clip.mp4')
    }
    expect(segments[0].inSec).toBe(0)
    expect(segments[1].inSec).toBeCloseTo(3, 9)
    expect(segments[2].inSec).toBeCloseTo(6, 9)
    expect(sumDurations(segments)).toBeCloseTo(9, 9)
  })

  it('round-robins slices across multiple clips within a beat', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 6, cutIntervalSec: 2 })]
    const beatFootage = { 0: ['a.mp4', 'b.mp4'] }
    const segments = buildBeatTimeline(beats, beatFootage, 6)

    // nSlices = round(6/2) = 3, clips round-robin: a, b, a.
    expect(segments.map((s) => s.assetPath)).toEqual(['a.mp4', 'b.mp4', 'a.mp4'])
    // Clip "a" is used at slice 0 and slice 2; its inSec should advance between uses.
    expect(segments[0].inSec).toBe(0)
    expect(segments[2].inSec).toBeCloseTo(2, 9)
    // Clip "b" is only used once, so it starts at 0.
    expect(segments[1].inSec).toBe(0)
  })

  it('ensures every clip gets at least one slice even when cutIntervalSec is very long', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 10, cutIntervalSec: 1000 })]
    const beatFootage = { 0: ['a.jpg', 'b.jpg', 'c.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 10)

    // nSlices = round(10/1000) = 0, but clips.length=3 forces at least 3 slices.
    expect(segments).toHaveLength(3)
    expect(new Set(segments.map((s) => s.assetPath))).toEqual(new Set(['a.jpg', 'b.jpg', 'c.jpg']))
    expect(sumDurations(segments)).toBeCloseTo(10, 9)
  })

  it('handles rounding edge cases where the duration does not divide evenly by cutIntervalSec', () => {
    // beatDur=10, cutIntervalSec=3 -> nSlices = round(10/3) = 3, each 10/3 = 3.333...
    const beats = [makeBeat({ index: 0, targetSeconds: 10, cutIntervalSec: 3 })]
    const beatFootage = { 0: ['a.mp4'] }
    const segments = buildBeatTimeline(beats, beatFootage, 10)

    expect(segments).toHaveLength(3)
    expect(sumDurations(segments)).toBeCloseTo(10, 9)
    // The last slice absorbs whatever remainder the repeated division left.
    expect(segments[2].durationSec).toBeCloseTo(10 - segments[0].durationSec - segments[1].durationSec, 9)
  })

  it('handles an audioDurationSec that does not divide evenly across many beats', () => {
    const beats = Array.from({ length: 7 }, (_, i) => makeBeat({ index: i, targetSeconds: 3 }))
    const beatFootage: Record<number, string[]> = {}
    beats.forEach((b) => {
      beatFootage[b.index] = [`clip-${b.index}.jpg`]
    })
    const audioDurationSec = 33.333333
    const segments = buildBeatTimeline(beats, beatFootage, audioDurationSec)

    expect(segments).toHaveLength(7)
    expect(sumDurations(segments)).toBeCloseTo(audioDurationSec, 6)
  })
})

describe('toCumulativeFrames', () => {
  it('maps a single segment to round(durationSec * fps) frames starting at 0', () => {
    const segments: TimelineSegment[] = [
      { beatIndex: 0, startSec: 0, durationSec: 2.5, assetPath: 'a.jpg', kind: 'image' },
    ]
    const spans = toCumulativeFrames(segments, 30)

    expect(spans).toHaveLength(1)
    expect(spans[0].startFrame).toBe(0)
    expect(spans[0].durationInFrames).toBe(Math.round(2.5 * 30))
  })

  it('cumulative frames land exactly on round(totalSeconds * fps) with no gaps', () => {
    const segments: TimelineSegment[] = [
      { beatIndex: 0, startSec: 0, durationSec: 1 / 3, assetPath: 'a.jpg', kind: 'image' },
      { beatIndex: 0, startSec: 1 / 3, durationSec: 1 / 3, assetPath: 'b.jpg', kind: 'image' },
      { beatIndex: 1, startSec: 2 / 3, durationSec: 1 / 3, assetPath: 'c.jpg', kind: 'image' },
    ]
    const fps = 30
    const totalSeconds = segments.reduce((acc, s) => acc + s.durationSec, 0)
    const spans = toCumulativeFrames(segments, fps)

    // Contiguous: each span starts exactly where the previous one ended.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].startFrame).toBe(spans[i - 1].startFrame + spans[i - 1].durationInFrames)
    }
    const lastSpan = spans[spans.length - 1]
    const finalFrame = lastSpan.startFrame + lastSpan.durationInFrames
    expect(finalFrame).toBe(Math.round(totalSeconds * fps))
  })

  it('never emits a zero-or-negative-length span even for a vanishingly short segment', () => {
    const segments: TimelineSegment[] = [
      { beatIndex: 0, startSec: 0, durationSec: 0.0001, assetPath: 'a.jpg', kind: 'image' },
      { beatIndex: 0, startSec: 0.0001, durationSec: 5, assetPath: 'b.jpg', kind: 'image' },
    ]
    const spans = toCumulativeFrames(segments, 25)
    for (const span of spans) {
      expect(span.durationInFrames).toBeGreaterThanOrEqual(1)
    }
  })

  it('matches toCumulativeFrames applied to a full buildBeatTimeline output (25fps ffmpeg grid)', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 4 }),
      makeBeat({ index: 1, targetSeconds: 9 }),
      makeBeat({ index: 2, targetSeconds: 2 }),
    ]
    const beatFootage = { 0: ['a.jpg'], 1: ['b.mp4', 'c.mp4'], 2: ['d.jpg'] }
    const audioDurationSec = 61.4
    const segments = buildBeatTimeline(beats, beatFootage, audioDurationSec)
    const fps = 25
    const spans = toCumulativeFrames(segments, fps)

    const lastSpan = spans[spans.length - 1]
    expect(lastSpan.startFrame + lastSpan.durationInFrames).toBe(Math.round(audioDurationSec * fps))
  })

  it('matches toCumulativeFrames applied to a full buildBeatTimeline output (30fps Remotion grid)', () => {
    const beats = [
      makeBeat({ index: 0, targetSeconds: 4 }),
      makeBeat({ index: 1, targetSeconds: 9 }),
      makeBeat({ index: 2, targetSeconds: 2 }),
    ]
    const beatFootage = { 0: ['a.jpg'], 1: ['b.mp4', 'c.mp4'], 2: ['d.jpg'] }
    const audioDurationSec = 61.4
    const segments = buildBeatTimeline(beats, beatFootage, audioDurationSec)
    const fps = 30
    const spans = toCumulativeFrames(segments, fps)

    const lastSpan = spans[spans.length - 1]
    expect(lastSpan.startFrame + lastSpan.durationInFrames).toBe(Math.round(audioDurationSec * fps))
  })
})
