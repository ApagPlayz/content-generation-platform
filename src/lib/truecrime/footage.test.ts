// Unit tests for the pure footage-query helpers (src/lib/truecrime/footage.ts).
// cueToQuery and namesRealSubject never touch the network/filesystem — they
// decide (a) what safe search string a beat's visual cue maps to, and
// (b) whether a beat's cue names a real case subject (so AI/stock tiers must
// be skipped for that beat). TIER_ALIASES is the pure synonym table the
// footage ladder resolves config strings through.

import { describe, expect, it } from 'vitest'
import { cueToQuery, namesRealSubject, TIER_ALIASES } from './footage'
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
