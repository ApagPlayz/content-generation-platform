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

import { describe, expect, it } from 'vitest'
import { archiveQuery, cueToQuery, namesRealSubject, TIER_ALIASES } from './footage'
import { isAcceptableStill, MIN_STILL_BYTES, MIN_STILL_DIM, posterSeekFraction } from './archiveFootage'
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
