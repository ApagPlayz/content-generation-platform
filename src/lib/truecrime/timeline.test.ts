// Unit tests for the pure beat-timeline builder (src/lib/truecrime/timeline.ts).
// These are the platform's first automated tests: they lock down the
// voice-sync invariants documented at the top of timeline.ts — segments must
// sum EXACTLY to the narration length, and frame conversion must land on
// round(totalSeconds * fps) with no cumulative drift.

import { describe, expect, it } from 'vitest'
import {
  buildBeatTimeline,
  buildMixedBeatFootage,
  MAX_CLIP_ONSCREEN_SEC,
  MIN_IMAGE_HOLD_SEC,
  toCumulativeFrames,
} from './timeline'
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

  it('shows a lone clip ONCE (no fast re-cutting); with no photo it covers the beat, inSec 0', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 9, cutIntervalSec: 3 })]
    const beatFootage = { 0: ['clip.mp4'] }
    const segments = buildBeatTimeline(beats, beatFootage, 9)

    // A moving excerpt is shown once (calm), not sliced by cutIntervalSec. With
    // no accompanying photo it absorbs the beat since there is nothing to cut to.
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('video')
    expect(segments[0].assetPath).toBe('clip.mp4')
    expect(segments[0].inSec).toBe(0)
    expect(sumDurations(segments)).toBeCloseTo(9, 9)
  })

  it('mixes a clip + photo in one beat: clip first (capped), then the photo fills the rest', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 20 })]
    const beatFootage = { 0: ['clip.mp4', 'photo.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 20, 8)

    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('video')
    expect(segments[0].assetPath).toBe('clip.mp4')
    expect(segments[0].durationSec).toBeCloseTo(8, 9) // capped on-screen time
    expect(segments[0].inSec).toBe(0)
    expect(segments[1].kind).toBe('image')
    expect(segments[1].assetPath).toBe('photo.jpg')
    expect(segments[1].durationSec).toBeCloseTo(12, 9) // remainder
    expect(sumDurations(segments)).toBeCloseTo(20, 9)
  })

  it('caps the clip even on a long beat and fills the remainder across multiple photos', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 30 })]
    const beatFootage = { 0: ['clip.mp4', 'p1.jpg', 'p2.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 30, 6)

    expect(segments[0].kind).toBe('video')
    expect(segments[0].durationSec).toBeCloseTo(6, 9) // clip capped at 6
    const stills = segments.filter((s) => s.kind === 'image')
    expect(stills).toHaveLength(2) // remaining 24s → 2 photos, 12s each
    for (const s of stills) expect(s.durationSec).toBeGreaterThanOrEqual(MIN_IMAGE_HOLD_SEC)
    expect(sumDurations(segments)).toBeCloseTo(30, 9)
  })

  describe('still-image pacing (round 6 — calm documentary cadence)', () => {
    /** The exact shape of the round-5 video the owner rejected: 71s narration,
     *  6 beats with the real seeded targetSeconds/cutIntervalSec, 2 stills per
     *  beat. The old slicer produced 35 segments (beat 4 alone: 13 cuts of
     *  1.18s, stills repeating A-B-A-B) — "scenes changing every half a
     *  second" + "scenes repeating". */
    function ownerRejectedShape() {
      const spec: [number, number][] = [
        [4, 3.5],
        [9, 3.5],
        [13, 2.5],
        [12, 2],
        [13, 1.2],
        [9, 2.5],
      ]
      const beats = spec.map(([targetSeconds, cutIntervalSec], i) =>
        makeBeat({ index: i, targetSeconds, cutIntervalSec })
      )
      const beatFootage: Record<number, string[]> = {}
      beats.forEach((b) => {
        beatFootage[b.index] = [`beat-${b.index}-0.jpg`, `beat-${b.index}-1.jpg`]
      })
      return { beats, beatFootage }
    }

    it('every still holds >= MIN_IMAGE_HOLD_SEC (or its whole short beat) — no sub-second cuts', () => {
      const { beats, beatFootage } = ownerRejectedShape()
      const segments = buildBeatTimeline(beats, beatFootage, 71)

      for (const seg of segments) {
        const beatSegs = segments.filter((s) => s.beatIndex === seg.beatIndex)
        if (beatSegs.length > 1) {
          expect(seg.durationSec).toBeGreaterThanOrEqual(MIN_IMAGE_HOLD_SEC)
        }
      }
      expect(sumDurations(segments)).toBeCloseTo(71, 9)
    })

    it('never shows the same still twice within a beat (no A-B-A-B cycling)', () => {
      const { beats, beatFootage } = ownerRejectedShape()
      const segments = buildBeatTimeline(beats, beatFootage, 71)

      for (const b of beats) {
        const paths = segments.filter((s) => s.beatIndex === b.index).map((s) => s.assetPath)
        expect(new Set(paths).size).toBe(paths.length)
      }
    })

    it('cuts the owner-rejected 35-segment timeline down to ~11 calm holds', () => {
      const { beats, beatFootage } = ownerRejectedShape()
      const segments = buildBeatTimeline(beats, beatFootage, 71)

      // Beat 0 (4.73s) holds ONE still; every other beat holds its two stills
      // once each: 1 + 2*5 = 11 segments, average hold 71/11 ≈ 6.5s (was 2.0s).
      expect(segments).toHaveLength(11)
      const avg = 71 / segments.length
      expect(avg).toBeGreaterThanOrEqual(MIN_IMAGE_HOLD_SEC)
    })

    it('a short beat with 2 stills shows only the FIRST, held for the whole beat', () => {
      const beats = [makeBeat({ index: 0, targetSeconds: 4, cutIntervalSec: 1.2 })]
      const beatFootage = { 0: ['a.jpg', 'b.jpg'] }
      const segments = buildBeatTimeline(beats, beatFootage, 4)

      expect(segments).toHaveLength(1)
      expect(segments[0].assetPath).toBe('a.jpg')
      expect(segments[0].durationSec).toBeCloseTo(4, 9)
    })

    it('a moving clip is capped at MAX_CLIP_ONSCREEN_SEC, then the beat cuts to a photo', () => {
      const beats = [makeBeat({ index: 0, targetSeconds: 12, cutIntervalSec: 1.5 })]
      const beatFootage = { 0: ['reel.mp4', 'photo.jpg'] }
      const segments = buildBeatTimeline(beats, beatFootage, 12)

      // No fast re-cutting: one clip (≤ MAX_CLIP_ONSCREEN_SEC) then a photo that
      // still gets its min hold (a 12s beat shrinks the clip to 7 so the photo
      // holds 5 rather than flashing).
      expect(segments).toHaveLength(2)
      expect(segments[0].kind).toBe('video')
      expect(segments[0].durationSec).toBeLessThanOrEqual(MAX_CLIP_ONSCREEN_SEC + 1e-9)
      expect(segments[1].kind).toBe('image')
      expect(segments[1].durationSec).toBeGreaterThanOrEqual(MIN_IMAGE_HOLD_SEC - 1e-9)
      expect(sumDurations(segments)).toBeCloseTo(12, 9)
    })
  })

  it('a mixed beat sums EXACTLY to the beat duration (clip cap + photo remainder)', () => {
    const beats = [makeBeat({ index: 0, targetSeconds: 10 })]
    const beatFootage = { 0: ['a.mp4', 'b.jpg'] }
    const segments = buildBeatTimeline(beats, beatFootage, 10, 8)

    expect(segments).toHaveLength(2)
    expect(sumDurations(segments)).toBeCloseTo(10, 9)
    // The photo (last cell) absorbs whatever remainder the clip cap left.
    expect(segments[1].durationSec).toBeCloseTo(10 - segments[0].durationSec, 9)
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

describe('buildMixedBeatFootage', () => {
  const beats = [
    makeBeat({ index: 0 }),
    makeBeat({ index: 1 }),
    makeBeat({ index: 2 }),
    makeBeat({ index: 3 }),
  ]

  it('distributes photos across every beat and puts the clip FIRST on a clip-beat', () => {
    const clips = { 2: ['clip.mp4'] }
    const photos = ['p0.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg']
    const mixed = buildMixedBeatFootage(beats, clips, photos)

    // Every beat gets footage; the clip-beat lists the clip before its photo.
    for (const b of beats) expect(mixed[b.index]?.length).toBeGreaterThan(0)
    expect(mixed[2][0]).toBe('clip.mp4')
    expect(mixed[2].slice(1).every((p) => p.endsWith('.jpg'))).toBe(true)
    // Every photo is placed somewhere, none dropped.
    const placed = Object.values(mixed).flat().filter((p) => p.endsWith('.jpg'))
    expect(new Set(placed)).toEqual(new Set(photos))
  })

  it('guarantees a clip-beat gets at least one photo to fill after its capped clip', () => {
    // Fewer photos than beats: the clip-beat must still receive a photo.
    const clips = { 1: ['clip.mp4'] }
    const photos = ['p0.jpg', 'p1.jpg']
    const mixed = buildMixedBeatFootage(beats, clips, photos)

    expect(mixed[1][0]).toBe('clip.mp4')
    expect(mixed[1].some((p) => p.endsWith('.jpg'))).toBe(true)
  })

  it('is photos-only (no clips) → each beat just carries its photos', () => {
    const mixed = buildMixedBeatFootage(beats, {}, ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    for (const b of beats) {
      expect(mixed[b.index]).toHaveLength(1)
      expect(mixed[b.index][0].endsWith('.jpg')).toBe(true)
    }
  })

  it('feeds buildBeatTimeline a genuine clip+photo mix', () => {
    const clips = { 1: ['clip.mp4'] }
    const photos = ['p0.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg']
    const mixed = buildMixedBeatFootage(beats, clips, photos)
    const segments = buildBeatTimeline(beats, mixed, 60, 8)

    expect(segments.some((s) => s.kind === 'video')).toBe(true)
    expect(segments.some((s) => s.kind === 'image')).toBe(true)
    expect(segments.reduce((a, s) => a + s.durationSec, 0)).toBeCloseTo(60, 6)
    // No clip segment exceeds the on-screen cap.
    for (const s of segments) if (s.kind === 'video') expect(s.durationSec).toBeLessThanOrEqual(8 + 1e-6)
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
