// Unit tests for the pure footage helpers. cueToQuery, archiveQuery and
// namesRealSubject (src/lib/truecrime/footage.ts) never touch the
// network/filesystem — they decide (a) what safe search string a beat's visual
// cue maps to, (b) what topic+year query the archive.org tier searches with,
// and (c) whether a beat's cue names a real case subject (so AI/stock tiers
// must be skipped for that beat). TIER_ALIASES is the pure synonym table the
// footage ladder resolves config strings through. posterSeekFraction and
// isAcceptableStill (src/lib/truecrime/archiveFootage.ts) are the pure halves
// of the junk-still gate: deterministic poster-seek offsets and still stats
// accept/reject.

import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { archivePoolQueries, archiveQuery, cueToQuery, MULTI_SLOT_TIERS, namesRealSubject, TIER_ALIASES, walkTierLadder } from './footage'
import type { Tier, TierInput, TierOutput } from './footage'
import { archiveTier } from './footage/archiveOrg'
import {
  alternateSeekFraction,
  ArchiveStillPool,
  BRIGHTEN_LUMA_BELOW,
  BRIGHTEN_LUMA_TARGET,
  brightenGamma,
  isAcceptableStill,
  isBrightEnoughStill,
  isFlatColorCard,
  MIN_STILL_BYTES,
  MIN_STILL_DIM,
  MIN_STILL_LUMA,
  parseFileLengthSec,
  pickBestFile,
  pickNextIdentifier,
  posterSeekFraction,
  RELAXED_ARCHIVE_COLLECTIONS,
  stillLumaVerdict,
} from './archiveFootage'
import type { ArchiveDoc, ArchiveFootageResult, ArchivePoolDeps } from './archiveFootage'
import type { CaseBrief } from './types'
import type { CaseSubject } from '../compliance'

function makeSubject(overrides: Partial<CaseSubject> = {}): CaseSubject {
  return {
    name: 'John Smith',
    role: 'accused',
    living: true,
    isMinor: false,
    ...overrides,
  }
}

function makeBrief(subjects: CaseSubject[] = []): CaseBrief {
  return {
    caseName: 'Test Case',
    wikipediaTitle: 'Test Case',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Test_Case',
    summary: '',
    facts: [],
    subjects,
    livingWarnings: [],
  }
}

describe('cueToQuery', () => {
  it('maps a themed cue to its canonical safe query before ever looking at subjects', () => {
    const brief = makeBrief([makeSubject({ name: 'John Smith' })])
    // "courtroom" matches the CUE_QUERY_MAP even though the cue also names the subject.
    expect(cueToQuery('John Smith in the courtroom', brief)).toBe('empty courtroom interior')
  })

  it('matches several themed categories against their canonical query', () => {
    const brief = makeBrief()
    expect(cueToQuery('the old jail cell', brief)).toBe('empty prison hallway')
    expect(cueToQuery('a police siren in the distance', brief)).toBe('police car lights at night')
    expect(cueToQuery('yellowed newspaper clipping', brief)).toBe('vintage newspaper macro')
  })

  it('strips a real subject name out of an otherwise-unmatched cue', () => {
    const brief = makeBrief([makeSubject({ name: 'Jane Doe' })])
    expect(cueToQuery('Jane Doe stares at the horizon quietly', brief)).toBe(
      'stares at the horizon quietly'
    )
  })

  it('strips subject names case-insensitively', () => {
    const brief = makeBrief([makeSubject({ name: 'Jane Doe' })])
    expect(cueToQuery('jane doe stares at the horizon quietly', brief)).toBe(
      'stares at the horizon quietly'
    )
  })

  it('falls back to a generic atmosphere query for an empty/unknown cue', () => {
    const brief = makeBrief()
    expect(cueToQuery('', brief)).toBe('dark moody atmosphere')
  })

  it('falls back to a generic atmosphere query when stripping the subject leaves nothing usable', () => {
    const brief = makeBrief([makeSubject({ name: 'Jane Doe' })])
    // Cue is *only* the subject's name and punctuation — nothing left after stripping.
    expect(cueToQuery('Jane Doe!!!', brief)).toBe('dark moody atmosphere')
  })
})

describe('namesRealSubject', () => {
  it('returns false for an empty visual cue', () => {
    const brief = makeBrief([makeSubject({ name: 'John Smith' })])
    expect(namesRealSubject({ ...beatFixture(), visualCue: '' }, brief)).toBe(false)
  })

  it('returns true when the cue contains the subject full name', () => {
    const brief = makeBrief([makeSubject({ name: 'Jane Doe' })])
    const beat = beatFixture({ visualCue: "Close-up of Jane Doe's face" })
    expect(namesRealSubject(beat, brief)).toBe(true)
  })

  it('returns true on a distinctive surname/token match (>= 4 chars) even without the full name', () => {
    const brief = makeBrief([makeSubject({ name: 'John Smith' })])
    const beat = beatFixture({ visualCue: 'Smith walks into the room' })
    expect(namesRealSubject(beat, brief)).toBe(true)
  })

  it('ignores short (<4 char) name tokens, so they cannot trigger a false match', () => {
    const brief = makeBrief([makeSubject({ name: 'Al Li' })])
    const beat = beatFixture({ visualCue: 'Al is walking away down the street' })
    expect(namesRealSubject(beat, brief)).toBe(false)
  })

  it('returns false when no subject is named in the cue', () => {
    const brief = makeBrief([makeSubject({ name: 'John Smith' })])
    const beat = beatFixture({ visualCue: 'empty courtroom, cold light' })
    expect(namesRealSubject(beat, brief)).toBe(false)
  })

  it('does not match a substring inside another word (word-boundary check)', () => {
    const brief = makeBrief([makeSubject({ name: 'John Smithson' })])
    // "Smith" is not a standalone token here, "Smithson" is — the cue below
    // contains "Smith" only as a prefix of an unrelated word.
    const beat = beatFixture({ visualCue: 'The blacksmithing shop on Main Street' })
    expect(namesRealSubject(beat, brief)).toBe(false)
  })
})

describe('archiveQuery', () => {
  it('folds the case topic and year into the query (Panic of 1907 regression)', () => {
    const brief = { ...makeBrief(), caseName: 'The Panic of 1907', year: 1907 }
    // The generic cue alone ("vintage newspaper macro") found a 1963 school
    // film; the topic+year anchors the search to the actual story's era.
    expect(archiveQuery('vintage newspaper macro', brief)).toBe('panic 1907 vintage newspaper macro')
  })

  it('appends the year when the case name does not already contain it', () => {
    const brief = { ...makeBrief(), caseName: 'Wall Street Bankers Panic', year: 1907 }
    expect(archiveQuery('city street at night', brief)).toBe('wall street bankers panic 1907 city at night')
  })

  it('omits the year cleanly when the brief has none', () => {
    const brief = { ...makeBrief(), caseName: 'Wall Street Bankers Panic' }
    expect(archiveQuery('city street at night', brief)).toBe('wall street bankers panic city at night')
  })

  it('strips a living subject name (and distinctive tokens) from the topic', () => {
    const brief = {
      ...makeBrief([makeSubject({ name: 'John Smith', living: true })]),
      caseName: 'Trial of John Smith',
      year: 1999,
    }
    const q = archiveQuery('empty courtroom interior', brief)
    expect(q).toBe('trial 1999 empty courtroom interior')
    expect(q).not.toContain('smith')
    expect(q).not.toContain('john')
  })

  it('keeps a subject explicitly marked not-living (historical archive search may use the name)', () => {
    const brief = {
      ...makeBrief([makeSubject({ name: 'Jesse James', living: false })]),
      caseName: 'Jesse James Train Robbery',
      year: 1873,
    }
    expect(archiveQuery('empty road at night', brief)).toBe('jesse james train robbery 1873 empty road at night')
  })

  it('dedupes tokens shared by the topic and the cue', () => {
    const brief = { ...makeBrief(), caseName: 'The Panic of 1907', year: 1907 }
    expect(archiveQuery('panic on wall street', brief)).toBe('panic 1907 on wall street')
  })

  it('falls back to the atmosphere query when everything strips away', () => {
    const brief = { ...makeBrief([makeSubject({ name: 'Jane Doe', living: true })]), caseName: 'Jane Doe' }
    expect(archiveQuery('', brief)).toBe('dark moody atmosphere')
  })
})

describe('posterSeekFraction', () => {
  it('always lands inside the 20-70% window', () => {
    for (let i = 0; i < 50; i++) {
      const f = posterSeekFraction(i, `item-${i}`)
      expect(f).toBeGreaterThanOrEqual(0.2)
      expect(f).toBeLessThanOrEqual(0.7)
    }
  })

  it('is deterministic for the same beat index and seed (no Math.random)', () => {
    expect(posterSeekFraction(3, 'OneGotFa1963')).toBe(posterSeekFraction(3, 'OneGotFa1963'))
  })

  it('varies by beat index, so beats grab different frames of the same reel', () => {
    const fractions = new Set(Array.from({ length: 8 }, (_, i) => posterSeekFraction(i, 'OneGotFa1963')))
    expect(fractions.size).toBeGreaterThan(1)
  })

  it('varies by item seed', () => {
    const fractions = new Set(['reel-a', 'reel-b', 'reel-c', 'reel-d'].map((s) => posterSeekFraction(0, s)))
    expect(fractions.size).toBeGreaterThan(1)
  })
})

describe('isAcceptableStill', () => {
  it('accepts a normal still', () => {
    expect(isAcceptableStill({ bytes: 250_000, width: 1280, height: 720 })).toBe(true)
  })

  it('rejects files under the minimum byte size (thumbnails, truncated downloads)', () => {
    expect(isAcceptableStill({ bytes: MIN_STILL_BYTES - 1, width: 1280, height: 720 })).toBe(false)
  })

  it('rejects non-finite sizes', () => {
    expect(isAcceptableStill({ bytes: Number.NaN, width: 1280, height: 720 })).toBe(false)
  })

  it('rejects tiny dimensions on either axis', () => {
    expect(isAcceptableStill({ bytes: 50_000, width: MIN_STILL_DIM - 1, height: 720 })).toBe(false)
    expect(isAcceptableStill({ bytes: 50_000, width: 1280, height: MIN_STILL_DIM - 1 })).toBe(false)
  })

  it('treats unknown (null) dimensions as unknown, not a rejection — the ffmpeg decode pass owns corruption', () => {
    expect(isAcceptableStill({ bytes: 50_000, width: null, height: null })).toBe(true)
  })
})

describe('alternateSeekFraction', () => {
  it('shifts a quarter-reel forward when that stays inside the 20-70% window', () => {
    expect(alternateSeekFraction(0.3)).toBeCloseTo(0.55, 10)
  })

  it('folds backward when a forward shift would leave the window', () => {
    expect(alternateSeekFraction(0.6)).toBeCloseTo(0.35, 10)
  })

  it('always lands inside the 20-70% window for any in-window input', () => {
    for (let f = 0.2; f <= 0.7; f += 0.05) {
      const alt = alternateSeekFraction(f)
      expect(alt).toBeGreaterThanOrEqual(0.2)
      expect(alt).toBeLessThanOrEqual(0.7)
      expect(alt).not.toBeCloseTo(f, 10) // genuinely a different timestamp
    }
  })
})

describe('isBrightEnoughStill', () => {
  it('accepts a normally lit frame', () => {
    expect(isBrightEnoughStill(118.4)).toBe(true)
  })

  it('rejects a near-black frame below the HARD luma floor', () => {
    expect(isBrightEnoughStill(MIN_STILL_LUMA - 1)).toBe(false)
    expect(isBrightEnoughStill(0)).toBe(false)
  })

  it('accepts exactly the floor (dark-but-recoverable frames get brightened, not rejected)', () => {
    expect(isBrightEnoughStill(MIN_STILL_LUMA)).toBe(true)
  })

  it('passes an unmeasurable (null) luma — a failed probe is not proof of black', () => {
    expect(isBrightEnoughStill(null)).toBe(true)
  })

  it('rejects non-finite measurements', () => {
    expect(isBrightEnoughStill(Number.NaN)).toBe(false)
  })
})

describe('stillLumaVerdict', () => {
  it('hard-rejects only near-black frames', () => {
    expect(stillLumaVerdict(0)).toBe('reject')
    expect(stillLumaVerdict(MIN_STILL_LUMA - 1)).toBe('reject')
    expect(stillLumaVerdict(Number.NaN)).toBe('reject')
  })

  it('brightens the dark-but-recoverable band instead of rejecting it', () => {
    expect(stillLumaVerdict(MIN_STILL_LUMA)).toBe('brighten')
    expect(stillLumaVerdict(BRIGHTEN_LUMA_BELOW - 1)).toBe('brighten')
  })

  it('passes healthy era-reel frames untouched (round-4 probe measured 54-134)', () => {
    expect(stillLumaVerdict(BRIGHTEN_LUMA_BELOW)).toBe('ok')
    expect(stillLumaVerdict(54)).toBe('ok')
    expect(stillLumaVerdict(134)).toBe('ok')
  })

  it('treats an unmeasurable (null) luma as ok — fail-open like every probe', () => {
    expect(stillLumaVerdict(null)).toBe('ok')
  })
})

describe('brightenGamma', () => {
  it('lifts darker frames harder (monotonically decreasing with luma)', () => {
    expect(brightenGamma(MIN_STILL_LUMA)).toBeGreaterThan(brightenGamma(BRIGHTEN_LUMA_BELOW - 1))
  })

  it('stays within the clamp so a lift never turns to grey noise', () => {
    for (const y of [1, MIN_STILL_LUMA, 20, BRIGHTEN_LUMA_BELOW - 1]) {
      const g = brightenGamma(y)
      expect(g).toBeGreaterThanOrEqual(1)
      expect(g).toBeLessThanOrEqual(2.2)
    }
  })

  it('never darkens: a frame at or above the target maps to gamma 1', () => {
    expect(brightenGamma(BRIGHTEN_LUMA_TARGET)).toBe(1)
    expect(brightenGamma(200)).toBe(1)
  })

  it('is a no-op (gamma 1) for degenerate measurements', () => {
    expect(brightenGamma(0)).toBe(1)
    expect(brightenGamma(-5)).toBe(1)
    expect(brightenGamma(Number.NaN)).toBe(1)
  })
})

describe('pickNextIdentifier', () => {
  it('walks distinct identifiers in order before ever repeating one', () => {
    const ordered = ['a', 'b', 'c']
    const counts = new Map<string, number>()
    const picks: string[] = []
    for (let beat = 0; beat < 6; beat++) {
      const id = pickNextIdentifier(ordered, counts)
      expect(id).not.toBeNull()
      picks.push(id as string)
      counts.set(id as string, (counts.get(id as string) ?? 0) + 1)
    }
    // 3 distinct first, then a second round-robin pass — never 'a' twice in a row.
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('prefers a never-used identifier over an already-used one regardless of order', () => {
    const counts = new Map([['a', 2]])
    expect(pickNextIdentifier(['a', 'b'], counts)).toBe('b')
  })

  it('returns null only for an empty candidate list', () => {
    expect(pickNextIdentifier([], new Map())).toBeNull()
  })
})

describe('ArchiveStillPool', () => {
  function doc(identifier: string): ArchiveDoc {
    return { identifier, title: identifier, mediatype: 'movies' }
  }

  function okResult(identifier: string, variant?: string): ArchiveFootageResult {
    return {
      visual: {
        kind: 'image',
        source: `https://archive.org/details/${identifier}`,
        license: 'unknown',
        depictsRealPerson: true,
        aiGenerated: false,
      },
      localPath: `/tmp/${identifier}${variant ? `__${variant}` : ''}.jpg`,
    }
  }

  /** True when a search call used the curated relaxed collection list rather
   *  than the pool's own scoped collections. */
  function isRelaxedSearch(collections: string[]): boolean {
    return collections === RELAXED_ARCHIVE_COLLECTIONS || collections.includes('universal_newsreels')
  }

  /** Fake deps: a fixed doc set per (scoped | relaxed) search, every resolve
   *  succeeding unless the identifier is listed in `failing`. */
  function fakeDeps(scoped: string[], relaxed: string[] = [], failing: string[] = []) {
    const searches: { query: string; collections: string[] }[] = []
    const resolves: { identifier: string; beatIndex?: number; variant?: string }[] = []
    const deps: ArchivePoolDeps = {
      search: async (query, collections) => {
        searches.push({ query, collections })
        return (isRelaxedSearch(collections) ? relaxed : scoped).map(doc)
      },
      resolve: async (d, opts, variant) => {
        resolves.push({ identifier: d.identifier as string, beatIndex: opts.beatIndex, variant })
        if (failing.includes(d.identifier as string)) return null
        return okResult(d.identifier as string, variant)
      },
    }
    return { deps, searches, resolves }
  }

  it('distributes DISTINCT identifiers across beats — no reel repeats until exhaustion', async () => {
    const { deps } = fakeDeps(['reel-a', 'reel-b', 'reel-c'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 3 }, deps)
    const sources = []
    for (let beat = 0; beat < 3; beat++) {
      const result = await pool.acquireStill(beat)
      sources.push(result?.visual.source)
    }
    expect(new Set(sources).size).toBe(3)
  })

  it('searches once per video, not once per beat', async () => {
    const { deps, searches } = fakeDeps(['reel-a', 'reel-b', 'reel-c'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 3 }, deps)
    for (let beat = 0; beat < 3; beat++) await pool.acquireStill(beat)
    expect(searches.length).toBe(1)
  })

  it('relaxes to the CURATED historical collections (never unscoped) when scoped hits are fewer than beats', async () => {
    const { deps, searches } = fakeDeps(['reel-a'], ['reel-a', 'wide-b', 'wide-c'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 3, collections: ['prelinger'] }, deps)
    const sources = []
    for (let beat = 0; beat < 3; beat++) sources.push((await pool.acquireStill(beat))?.visual.source)
    // Second search pass ran against the curated era-appropriate collections…
    expect(searches.some((s) => s.collections === RELAXED_ARCHIVE_COLLECTIONS)).toBe(true)
    // …never with an empty (unscoped) collection clause — that pulled modern junk.
    expect(searches.every((s) => s.collections.length > 0)).toBe(true)
    // …and the widened pool kept all three beats distinct (no repeats needed).
    expect(new Set(sources).size).toBe(3)
  })

  it('keeps the SAME topic/year queries in the relaxed pass — terms stay mandatory', async () => {
    const { deps, searches } = fakeDeps(['reel-a'], ['wide-b'])
    const queries = ['standard oil 1882', 'standard oil']
    const pool = new ArchiveStillPool(queries, { beatCount: 3 }, deps)
    await pool.acquireStill(0)
    expect(searches.length).toBeGreaterThan(2) // both passes actually ran
    for (const s of searches) expect(queries).toContain(s.query)
  })

  it('prefers unused scoped items, then unused relaxed items, then least-used repeats', async () => {
    const { deps, resolves } = fakeDeps(['scoped-a'], ['relaxed-b'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 3 }, deps)
    for (let beat = 0; beat < 3; beat++) await pool.acquireStill(beat)
    expect(resolves.map((r) => r.identifier)).toEqual(['scoped-a', 'relaxed-b', 'scoped-a'])
    // The repeat (beat 2) is the LEAST-used identifier, as a distinct-frame variant.
    expect(resolves[2].variant).toBe('beat2')
  })

  it('does not relax when the scoped pool already covers every beat', async () => {
    const { deps, searches } = fakeDeps(['reel-a', 'reel-b', 'reel-c'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 3, collections: ['prelinger'] }, deps)
    await pool.acquireStill(0)
    expect(searches.some((s) => s.collections === RELAXED_ARCHIVE_COLLECTIONS)).toBe(false)
  })

  it('repeats only after all distinct hits are exhausted, as a beat-variant frame', async () => {
    const { deps, resolves } = fakeDeps(['reel-a', 'reel-b'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 4 }, deps)
    const picks = []
    for (let beat = 0; beat < 4; beat++) picks.push(await pool.acquireStill(beat))
    // Beats 0-1 took the two distinct reels with no variant…
    expect(resolves.slice(0, 2).map((r) => ({ id: r.identifier, variant: r.variant }))).toEqual([
      { id: 'reel-a', variant: undefined },
      { id: 'reel-b', variant: undefined },
    ])
    // …and only then do beats 2-3 reuse them, each as a beat-suffixed variant
    // (a different poster frame of the reel, not the identical cached image).
    expect(resolves.slice(2).map((r) => ({ id: r.identifier, variant: r.variant }))).toEqual([
      { id: 'reel-a', variant: 'beat2' },
      { id: 'reel-b', variant: 'beat3' },
    ])
    expect(picks.every(Boolean)).toBe(true)
  })

  it('marks a junk item dead, falls through to the next, and never retries it', async () => {
    const { deps, resolves } = fakeDeps(['bad-reel', 'reel-b'], [], ['bad-reel'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 2 }, deps)
    const first = await pool.acquireStill(0)
    expect(first?.visual.source).toContain('reel-b')
    await pool.acquireStill(1)
    // bad-reel was attempted exactly once, then skipped for the later beat.
    expect(resolves.filter((r) => r.identifier === 'bad-reel').length).toBe(1)
  })

  it('returns null (never throws) when nothing resolves', async () => {
    const { deps } = fakeDeps(['bad-a', 'bad-b'], [], ['bad-a', 'bad-b'])
    const pool = new ArchiveStillPool(['panic 1907'], { beatCount: 2 }, deps)
    expect(await pool.acquireStill(0)).toBeNull()
  })
})

describe('archivePoolQueries', () => {
  it('is topic-anchored only: topic+year, topic, then single-token-drop variants', () => {
    const brief = { ...makeBrief(), caseName: 'Wall Street Panic', year: 1907 }
    expect(archivePoolQueries(brief)).toEqual([
      'wall street panic 1907',
      'wall street panic',
      'street panic',
      'wall panic',
      'wall street',
    ])
  })

  it('recovers from one rare AND-zeroing token (Standard Oil round-4 regression)', () => {
    // archive.org ANDs every term: "breakup standard oil" finds NOTHING in any
    // collection while "standard oil" finds dozens of era reels. The drop
    // variants are what let the pool reach the reels that actually exist.
    const brief = { ...makeBrief(), caseName: 'The Breakup of Standard Oil', year: 1882 }
    const queries = archivePoolQueries(brief)
    expect(queries).toEqual([
      'breakup standard oil 1882',
      'breakup standard oil',
      'standard oil',
      'breakup oil',
      'breakup standard',
    ])
    // Every candidate still carries at least two topic words — never a bare
    // year or bare cue that could drift off-story.
    for (const q of queries) {
      expect(q.split(/\s+/).filter((t) => !/^\d+$/.test(t)).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('generates no drop variants for a short (2-token) topic', () => {
    const brief = { ...makeBrief(), caseName: 'The Panic of 1907', year: 1907 }
    expect(archivePoolQueries(brief)).toEqual(['panic 1907'])
  })

  it('strips a living subject from the topic, like every other archive query', () => {
    const brief = {
      ...makeBrief([makeSubject({ name: 'John Smith', living: true })]),
      caseName: 'Trial of John Smith',
      year: 1999,
    }
    expect(archivePoolQueries(brief)).toEqual(['trial 1999', 'trial'])
  })

  it('returns [] when the whole topic strips away — the caller must skip the pool', () => {
    const brief = { ...makeBrief([makeSubject({ name: 'Jane Doe', living: true })]), caseName: 'Jane Doe' }
    expect(archivePoolQueries(brief)).toEqual([])
  })
})

describe('walkTierLadder', () => {
  function baseInput(): Omit<TierInput, 'dest'> {
    return {
      videoId: 'vid-test',
      beat: beatFixture(),
      beatIndex: 3,
      query: 'old documents on a desk',
      brief: makeBrief(),
      config: {},
      dir: '/tmp/vid-test',
      realSubject: false,
    }
  }

  /** A tier that succeeds `hits` times (staging into the given dest), then misses. */
  function fakeTier(name: string, hits: number, calls: TierInput[]): Tier {
    let used = 0
    return async (input) => {
      calls.push(input)
      if (used >= hits) return null
      used++
      const out: TierOutput = {
        imagePath: input.dest,
        asset: { kind: 'image', source: `${name}-${used}`, license: 'unknown', depictsRealPerson: false, aiGenerated: false },
      }
      return out
    }
  }

  it('a multi-slot tier fills BOTH per-beat slots, each staged at its own dest (both gated)', async () => {
    const calls: TierInput[] = []
    const tiers = { archive: fakeTier('archive', 5, calls) }
    const slots = await walkTierLadder(baseInput(), ['archive'], tiers, 2, (n) => `/tmp/beat-03-${n}.jpg`)
    expect(slots.length).toBe(2)
    // EVERY slot came out of a tier call with its own dest — nothing bypassed
    // the tier pipeline (round-5 regression: slot 1 used to skip all gates).
    expect(slots.map((s) => s.out.imagePath)).toEqual(['/tmp/beat-03-0.jpg', '/tmp/beat-03-1.jpg'])
    expect(calls.map((c) => c.dest)).toEqual(['/tmp/beat-03-0.jpg', '/tmp/beat-03-1.jpg'])
    // Each call knows which slot it fills, so a tier can vary its frame/seek.
    expect(calls.map((c) => c.slot)).toEqual([0, 1])
    // The two slots are distinct outputs, not one result duplicated.
    expect(slots[0].out.asset.source).not.toBe(slots[1].out.asset.source)
  })

  it('a single-shot tier (metered API) is never re-invoked; the next tier takes slot 1', async () => {
    const aiCalls: TierInput[] = []
    const moodCalls: TierInput[] = []
    const tiers = { ai_still: fakeTier('ai', 5, aiCalls), moodbank: fakeTier('mood', 5, moodCalls) }
    const slots = await walkTierLadder(baseInput(), ['ai_still', 'moodbank'], tiers, 2, (n) => `/d/${n}.jpg`)
    expect(MULTI_SLOT_TIERS.has('ai_still')).toBe(false)
    expect(aiCalls.length).toBe(1) // one shot only — a repeat would re-spend the API
    expect(slots.map((s) => s.tierName)).toEqual(['ai_still', 'moodbank'])
  })

  it('falls through to the next tier when a multi-slot tier runs dry mid-beat', async () => {
    const tiers = { archive: fakeTier('archive', 1, []), moodbank: fakeTier('mood', 5, []) }
    const slots = await walkTierLadder(baseInput(), ['archive', 'moodbank'], tiers, 2, (n) => `/d/${n}.jpg`)
    expect(slots.map((s) => s.tierName)).toEqual(['archive', 'moodbank'])
    expect(slots.map((s) => s.out.imagePath)).toEqual(['/d/0.jpg', '/d/1.jpg'])
  })

  it('a throwing tier never breaks the ladder', async () => {
    const boom: Tier = async () => {
      throw new Error('boom')
    }
    const tiers = { archive: boom, moodbank: fakeTier('mood', 5, []) }
    const slots = await walkTierLadder(baseInput(), ['archive', 'moodbank'], tiers, 2, (n) => `/d/${n}.jpg`)
    expect(slots.map((s) => s.tierName)).toEqual(['moodbank', 'moodbank'])
  })
})

describe('isFlatColorCard', () => {
  /** Build a raw rgb24 buffer of `n` pixels from a color generator. */
  function rgbBuffer(n: number, colorAt: (i: number) => [number, number, number]): Buffer {
    const buf = Buffer.alloc(n * 3)
    for (let i = 0; i < n; i++) {
      const [r, g, b] = colorAt(i)
      buf[i * 3] = r
      buf[i * 3 + 1] = g
      buf[i * 3 + 2] = b
    }
    return buf
  }

  it('flags an MPAA-style rating card: solid saturated green with white text', () => {
    // 85% saturated green background, 15% white "text" pixels.
    const card = rgbBuffer(1024, (i) => (i % 100 < 85 ? [16, 124, 56] : [255, 255, 255]))
    expect(isFlatColorCard(card)).toBe(true)
  })

  it('never flags b/w or sepia era footage (no saturation), even when flat', () => {
    const flatGray = rgbBuffer(1024, () => [120, 120, 120])
    expect(isFlatColorCard(flatGray)).toBe(false)
    const flatSepia = rgbBuffer(1024, () => [112, 92, 66]) // spread 46 < threshold
    expect(isFlatColorCard(flatSepia)).toBe(false)
  })

  it('never flags a varied real scene (no single dominant color bin)', () => {
    // Deterministic pseudo-noise across many bins.
    const scene = rgbBuffer(1024, (i) => [(i * 37) % 256, (i * 73) % 256, (i * 151) % 256])
    expect(isFlatColorCard(scene)).toBe(false)
  })

  it('a saturated color must DOMINATE to count as a card', () => {
    // Only 40% green — below the dominant-fraction threshold.
    const mixed = rgbBuffer(1024, (i) => (i % 100 < 40 ? [16, 124, 56] : [(i * 37) % 256, (i * 73) % 256, (i * 151) % 256]))
    expect(isFlatColorCard(mixed)).toBe(false)
  })

  it('fails open on malformed/tiny buffers', () => {
    expect(isFlatColorCard(Buffer.alloc(0))).toBe(false)
    expect(isFlatColorCard(Buffer.alloc(9))).toBe(false)
  })
})

describe('parseFileLengthSec', () => {
  it('parses plain seconds and clock notation', () => {
    expect(parseFileLengthSec('571.32')).toBeCloseTo(571.32, 2)
    expect(parseFileLengthSec('9:31')).toBe(571)
    expect(parseFileLengthSec('1:02:07')).toBe(3727)
  })

  it('returns 0 for absent or unparseable values', () => {
    expect(parseFileLengthSec(undefined)).toBe(0)
    expect(parseFileLengthSec('')).toBe(0)
    expect(parseFileLengthSec('n/a')).toBe(0)
  })
})

describe('pickBestFile', () => {
  it('prefers the LONGEST video file — a trailer/preview derivative never wins (MPAA-card regression)', () => {
    const meta = {
      files: [
        { name: 'reel_trailer.mp4', size: '900000', length: '62.0' },
        { name: 'reel_512kb.mp4', size: '4000000', length: '571.3' },
        { name: 'reel_full.mpg', size: '90000000', length: '571.3' },
      ],
    }
    // Longest wins; among equal lengths the larger file is preferred.
    expect(pickBestFile(meta, 'movies')?.name).toBe('reel_full.mpg')
  })

  it('falls back to size ordering when no video file reports a length', () => {
    const meta = {
      files: [
        { name: 'small.mp4', size: '900000' },
        { name: 'big.mp4', size: '4000000' },
      ],
    }
    expect(pickBestFile(meta, 'movies')?.name).toBe('big.mp4')
  })

  it('keeps the smallest-first pick for image items', () => {
    const meta = {
      files: [
        { name: 'huge.png', size: '9000000' },
        { name: 'small.jpg', size: '90000' },
      ],
    }
    expect(pickBestFile(meta, 'image')?.name).toBe('small.jpg')
  })

  it('still skips thumbnails', () => {
    const meta = { files: [{ name: 'x__ia_thumb.jpg', size: '10' }, { name: 'photo.jpg', size: '90000' }] }
    expect(pickBestFile(meta, 'image')?.name).toBe('photo.jpg')
  })
})

describe('archiveTier staging', () => {
  it('returns the staged per-video dest path, never the raw cache path (Remotion black-beat regression)', async () => {
    // The Remotion render serves ONLY media/<videoId>/ and references assets by
    // basename — a raw media/stock/archive.org/ cache path 404s and the beat
    // renders black. The tier must copy the pool's still into `dest`.
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'archive-tier-'))
    const cachePath = path.join(tmp, 'cache', 'OneGotFa1963.jpg')
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, 'jpeg-bytes-large-enough-for-a-fixture')
    const videoDir = path.join(tmp, 'video')
    await mkdir(videoDir, { recursive: true })
    const dest = path.join(videoDir, 'beat-02-0.jpg')

    const deps: ArchivePoolDeps = {
      search: async () => [{ identifier: 'OneGotFa1963', mediatype: 'movies' }],
      resolve: async () => ({
        visual: {
          kind: 'image',
          source: 'https://archive.org/details/OneGotFa1963',
          license: 'unknown',
          depictsRealPerson: true,
          aiGenerated: false,
        },
        localPath: cachePath,
      }),
    }
    const archivePool = new ArchiveStillPool(['test topic'], { beatCount: 1 }, deps)

    const out = await archiveTier({
      videoId: 'vid-test',
      beat: beatFixture({ visualCue: 'old documents' }),
      beatIndex: 2,
      query: 'old documents on a desk',
      brief: makeBrief(),
      config: {},
      dir: videoDir,
      dest,
      realSubject: false,
      archivePool,
    })

    expect(out).not.toBeNull()
    expect(out?.imagePath).toBe(dest) // the servable staged path…
    expect(out?.imagePath).not.toBe(cachePath) // …never the raw cache path
    expect(existsSync(dest)).toBe(true)
    // The cache copy is untouched — a later cache purge cannot delete the
    // frame this beat already selected.
    expect(existsSync(cachePath)).toBe(true)
    expect(out?.asset.beatIndex).toBe(2)
  })

  it('misses (null) instead of leaking an unservable path when the pool still vanished', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'archive-tier-'))
    const deps: ArchivePoolDeps = {
      search: async () => [{ identifier: 'GhostReel', mediatype: 'movies' }],
      resolve: async () => ({
        visual: {
          kind: 'image',
          source: 'https://archive.org/details/GhostReel',
          license: 'unknown',
          depictsRealPerson: true,
          aiGenerated: false,
        },
        localPath: path.join(tmp, 'does-not-exist.jpg'),
      }),
    }
    const archivePool = new ArchiveStillPool(['test topic'], { beatCount: 1 }, deps)
    const out = await archiveTier({
      videoId: 'vid-test',
      beat: beatFixture(),
      beatIndex: 0,
      query: 'old documents on a desk',
      brief: makeBrief(),
      config: {},
      dir: tmp,
      dest: path.join(tmp, 'beat-00-0.jpg'),
      realSubject: false,
      archivePool,
    })
    expect(out).toBeNull()
  })
})

describe('TIER_ALIASES', () => {
  it('resolves known synonyms to their canonical tier key', () => {
    expect(TIER_ALIASES.ai).toBe('ai_still')
    expect(TIER_ALIASES.aistill).toBe('ai_still')
    expect(TIER_ALIASES['ai-still']).toBe('ai_still')
    expect(TIER_ALIASES.still).toBe('ai_still')
    expect(TIER_ALIASES.stills).toBe('ai_still')
    expect(TIER_ALIASES.pexels).toBe('stock')
    expect(TIER_ALIASES.pixabay).toBe('stock')
    expect(TIER_ALIASES['archive.org']).toBe('archive')
    expect(TIER_ALIASES.archiveorg).toBe('archive')
    expect(TIER_ALIASES.mood).toBe('moodbank')
    expect(TIER_ALIASES['mood-bank']).toBe('moodbank')
    expect(TIER_ALIASES.mood_bank).toBe('moodbank')
  })

  it('maps legacy wikimedia/commons names onto the placeholder floor', () => {
    expect(TIER_ALIASES.wikimedia).toBe('placeholder')
    expect(TIER_ALIASES.commons).toBe('placeholder')
  })

  it('leaves unknown tokens unresolved (caller falls through to a plain lookup miss)', () => {
    expect(TIER_ALIASES.bogus_tier).toBeUndefined()
  })
})

function beatFixture(overrides: Partial<{ visualCue: string }> = {}) {
  return {
    name: 'beat',
    index: 0,
    narration: '',
    targetSeconds: 10,
    visualCue: '',
    cutIntervalSec: 0,
    musicIntensity: 0,
    complianceFlag: 'factual' as const,
    ...overrides,
  }
}
