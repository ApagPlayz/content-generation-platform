// Unit tests for the mood-bank helpers (src/lib/truecrime/moodBank.ts).
// Round 4 gave the mood-bank tier era awareness (a pre-1950 story must never
// fall back onto modern police-car / neon-city / motorway clips) and per-video
// diversity (least-used-first clip picking, mirroring the archive pool).
// pickMoodCandidates is the pure matching ladder over an in-memory bank;
// pickLeastUsedClip is the pure per-video diversity pick. Round 5 routed
// extractMoodStill through the shared luma gate — the ffmpeg-backed describe
// at the bottom proves a near-black clip can no longer produce a still.

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  ANACHRONISTIC_MOOD_CATEGORIES,
  extractMoodStill,
  pickLeastUsedClip,
  pickMoodCandidates,
  VINTAGE_CUTOFF_YEAR,
} from './moodBank'
import { MIN_STILL_LUMA, stillLumaYAvg } from './archiveFootage'
import type { MoodClipEntry, MoodClipResult } from './moodBank'

function hasFfmpeg(): boolean {
  try {
    execFileSync('which', ['ffmpeg'])
    return true
  } catch {
    return false
  }
}

function entry(id: string, category: string, tags: string[] = []): MoodClipEntry {
  return { id, category, tags, file: `${id}.mp4`, source: 'archive.org', populated: true }
}

// Mirrors today's populated inventory: rain-tropical (palm leaves), modern
// police lights (the Škoda), a modern neon night street, and a foggy house.
const BANK: MoodClipEntry[] = [
  entry('rain-tropical-01', 'rain', ['rain', 'storm', 'weather']),
  entry('police-lights-gnr-01', 'police-lights', ['police', 'lights', 'night']),
  entry('night-street-hangzhou-01', 'night-street', ['street', 'city', 'night']),
  entry('foggy-house-search-02', 'foggy-house', ['fog', 'mist', 'exterior']),
]

describe('pickMoodCandidates', () => {
  it('maps a themed cue to its category', () => {
    const picks = pickMoodCandidates(BANK, 'rain on a window at night')
    expect(picks.map((e) => e.id)).toEqual(['rain-tropical-01'])
  })

  it('falls back to neutral categories (never nature) for an unmatched cue', () => {
    const picks = pickMoodCandidates(BANK, 'old map close up, slow drift')
    expect(picks.length).toBeGreaterThan(0)
    for (const p of picks) expect(p.category).not.toBe('rain')
  })

  it('excluded categories can never come back through a fallback (era guard)', () => {
    // A pre-1950 story's unmatched cue previously landed on the modern
    // night-street clip; with the anachronistic set excluded it must not.
    const picks = pickMoodCandidates(BANK, 'old map close up, slow drift', ANACHRONISTIC_MOOD_CATEGORIES)
    expect(picks.length).toBeGreaterThan(0)
    for (const p of picks) {
      expect(ANACHRONISTIC_MOOD_CATEGORIES).not.toContain(p.category)
    }
  })

  it('a cue whose own category is excluded falls back instead of matching it', () => {
    // "police car lights" maps to police-lights, which is anachronistic for a
    // vintage story — the pick must divert to something era-neutral.
    const picks = pickMoodCandidates(BANK, 'police car lights at night', ANACHRONISTIC_MOOD_CATEGORIES)
    for (const p of picks) {
      expect(ANACHRONISTIC_MOOD_CATEGORIES).not.toContain(p.category)
    }
  })

  it('returns [] when exclusion empties the bank — tier misses to the placeholder floor', () => {
    const modernOnly = BANK.filter((e) => e.category !== 'rain' && e.category !== 'foggy-house')
    expect(pickMoodCandidates(modernOnly, 'old documents', ANACHRONISTIC_MOOD_CATEGORIES)).toEqual([])
  })

  it('returns [] for an empty bank', () => {
    expect(pickMoodCandidates([], 'anything')).toEqual([])
  })
})

describe('pickLeastUsedClip', () => {
  const clip = (p: string): MoodClipResult => ({
    path: p,
    asset: { kind: 'video', source: p, license: 'cc0', depictsRealPerson: false, aiGenerated: false },
  })

  it('never repeats a clip while an unused candidate exists (per-video diversity)', () => {
    const candidates = [clip('/a.mp4'), clip('/b.mp4')]
    const usage = new Map<string, number>()
    const picks: string[] = []
    for (let beat = 0; beat < 4; beat++) {
      const c = pickLeastUsedClip(candidates, usage)
      expect(c).not.toBeNull()
      picks.push((c as MoodClipResult).path)
      usage.set((c as MoodClipResult).path, (usage.get((c as MoodClipResult).path) ?? 0) + 1)
    }
    // Both distinct clips first, then a least-used round-robin — never a/a/b/b.
    expect(picks).toEqual(['/a.mp4', '/b.mp4', '/a.mp4', '/b.mp4'])
  })

  it('prefers an unused clip over an already-used one regardless of order', () => {
    const usage = new Map([['/a.mp4', 1]])
    expect(pickLeastUsedClip([clip('/a.mp4'), clip('/b.mp4')], usage)?.path).toBe('/b.mp4')
  })

  it('returns null only for an empty candidate list', () => {
    expect(pickLeastUsedClip([], new Map())).toBeNull()
  })
})

// Real-ffmpeg proof that the mood-still path is gated end-to-end: a clip whose
// every frame is near-black must never yield a still (this was the round-5
// black-beat defect — beat-NN-1 stills bypassed all gates), while a normal
// clip still produces one, brightened when needed.
describe.skipIf(!hasFfmpeg())('extractMoodStill luma gate (ffmpeg)', () => {
  async function makeClip(color: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mood-gate-'))
    const clip = path.join(dir, `${color.replace(/[^a-z0-9]/gi, '')}.mp4`)
    execFileSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `color=${color}:s=320x240:d=12`,
      '-pix_fmt', 'yuv420p', clip,
    ])
    return clip
  }

  it('returns null for a near-black clip — no timestamp can pass the gate', async () => {
    const clip = await makeClip('black')
    const out = path.join(path.dirname(clip), 'still-black.jpg')
    expect(await extractMoodStill(clip, out, 3)).toBeNull()
    expect(existsSync(out)).toBe(false)
  }, 30_000)

  it('returns a legible still for a normal clip (brightened if it was dark)', async () => {
    // 0x404040 ≈ YAVG 64 — passes the gate untouched.
    const clip = await makeClip('0x404040')
    const out = path.join(path.dirname(clip), 'still-gray.jpg')
    const result = await extractMoodStill(clip, out, 3)
    expect(result).toBe(out)
    expect(existsSync(out)).toBe(true)
    const yavg = await stillLumaYAvg(out)
    expect(yavg).not.toBeNull()
    expect(yavg as number).toBeGreaterThanOrEqual(MIN_STILL_LUMA)
  }, 30_000)
})

describe('era constants', () => {
  it('flags the modern-subject categories and a sensible vintage cutoff', () => {
    expect(ANACHRONISTIC_MOOD_CATEGORIES).toEqual(['police-lights', 'night-street', 'highway-night'])
    expect(VINTAGE_CUTOFF_YEAR).toBe(1950)
  })
})
