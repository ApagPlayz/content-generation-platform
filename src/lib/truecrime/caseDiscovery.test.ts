// Unit tests for the discovery media-richness gate (round 6). The owner's
// core complaint: an 1882 story has no usable era footage, so no downstream
// fix can make its video look good — discovery must reject media-poor topics
// up front. pickMediaRichCandidate (src/lib/truecrime/caseDiscovery.ts) is the
// shared, counter-injected selection walk used by BOTH F10 discoverCase and
// F11 discoverTopic; countDistinctArchiveItems (archiveFootage.ts) is the
// probe that counts a topic's distinct archive.org inventory with the same
// gather machinery the footage stage uses later.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIN_ARCHIVE_HITS,
  DEFAULT_MIN_TOPIC_YEAR,
  passesEraFloor,
  pickMediaRichCandidate,
} from './caseDiscovery'
import { countDistinctArchiveItems, RELAXED_ARCHIVE_COLLECTIONS } from './archiveFootage'
import type { ArchiveDoc, ArchivePoolDeps } from './archiveFootage'

describe('pickMediaRichCandidate', () => {
  const watchlist = ['tulip-mania-1637', 'standard-oil-1882', 'crash-1929', 'ponzi-1920']
  /** Fake archive inventory per topic: pre-1900 topics are media-poor. */
  const inventory: Record<string, number> = {
    'tulip-mania-1637': 0,
    'standard-oil-1882': 3,
    'crash-1929': 25,
    'ponzi-1920': 12,
  }
  const counter = async (name: string) => inventory[name] ?? 0

  it('skips media-poor candidates and picks the first well-documented one after the day index', async () => {
    const pick = await pickMediaRichCandidate(watchlist, 0, 8, counter)
    // tulip (0 hits) and standard oil (3) fail the floor; crash-1929 passes.
    expect(pick).toEqual({ chosen: 'crash-1929', hits: 25, passed: true })
  })

  it('keeps the day-pick when it is already media-rich', async () => {
    const pick = await pickMediaRichCandidate(watchlist, 2, 8, counter)
    expect(pick).toEqual({ chosen: 'crash-1929', hits: 25, passed: true })
  })

  it('wraps around the watchlist when the rich candidates sit before the day index', async () => {
    const pick = await pickMediaRichCandidate(watchlist, 3, 20, counter)
    // ponzi (12) misses the higher floor; wrap: tulip 0, standard-oil 3, crash 25 ✓.
    expect(pick).toEqual({ chosen: 'crash-1929', hits: 25, passed: true })
  })

  it('fails OPEN to the plain day-pick when no candidate meets the floor', async () => {
    const pick = await pickMediaRichCandidate(watchlist, 1, 100, counter)
    expect(pick).toEqual({ chosen: 'standard-oil-1882', hits: 3, passed: false })
  })

  it('threshold 0 disables the gate entirely — no probes, plain day rotation', async () => {
    let probes = 0
    const pick = await pickMediaRichCandidate(watchlist, 1, 0, async () => {
      probes++
      return 0
    })
    expect(pick.chosen).toBe('standard-oil-1882')
    expect(pick.passed).toBe(true)
    expect(probes).toBe(0)
  })

  it('a throwing probe counts as 0 hits and never dead-ends discovery', async () => {
    const pick = await pickMediaRichCandidate(watchlist, 0, 8, async (name) => {
      if (name === 'tulip-mania-1637') throw new Error('network down')
      return inventory[name] ?? 0
    })
    expect(pick).toEqual({ chosen: 'crash-1929', hits: 25, passed: true })
  })

  it('ships a sensible default floor', () => {
    expect(DEFAULT_MIN_ARCHIVE_HITS).toBe(8)
  })
})

describe('passesEraFloor', () => {
  it('rejects stories set before the era floor — pre-photography topics have no real footage', () => {
    // The owner-rejected case: 1882 predates newsreels; word-overlap search
    // hits ("standard oil" gasoline ads, "south sea" travelogues) don't count.
    expect(passesEraFloor(1882, DEFAULT_MIN_TOPIC_YEAR)).toBe(false)
    expect(passesEraFloor(1720, DEFAULT_MIN_TOPIC_YEAR)).toBe(false)
    expect(passesEraFloor(1637, DEFAULT_MIN_TOPIC_YEAR)).toBe(false)
  })

  it('accepts newsreel-era stories (1900+)', () => {
    expect(passesEraFloor(1900, DEFAULT_MIN_TOPIC_YEAR)).toBe(true)
    expect(passesEraFloor(1929, DEFAULT_MIN_TOPIC_YEAR)).toBe(true)
    expect(passesEraFloor(1975, DEFAULT_MIN_TOPIC_YEAR)).toBe(true)
  })

  it('passes an unknown year — media richness is then the only gate', () => {
    expect(passesEraFloor(undefined, DEFAULT_MIN_TOPIC_YEAR)).toBe(true)
  })

  it('a floor of 0 disables the era check', () => {
    expect(passesEraFloor(1637, 0)).toBe(true)
  })

  it('ships a sensible default era floor', () => {
    expect(DEFAULT_MIN_TOPIC_YEAR).toBe(1900)
  })
})

describe('countDistinctArchiveItems', () => {
  function docs(ids: string[]): ArchiveDoc[] {
    return ids.map((identifier) => ({ identifier, mediatype: 'movies' }))
  }

  it('counts distinct identifiers across the scoped pass, deduped, capped at need', async () => {
    const search: ArchivePoolDeps['search'] = async () => docs(['a', 'b', 'c', 'a', 'b'])
    expect(await countDistinctArchiveItems(['q1'], { need: 8 }, search)).toBe(3)
    expect(await countDistinctArchiveItems(['q1'], { need: 2 }, search)).toBe(2) // capped
  })

  it('tops up from the curated relaxed collections when the scoped pass is short', async () => {
    const search: ArchivePoolDeps['search'] = async (_q, collections) =>
      collections === RELAXED_ARCHIVE_COLLECTIONS ? docs(['a', 'x', 'y']) : docs(['a'])
    // scoped: {a}; relaxed adds {x, y} (a dedupes) → 3 distinct.
    expect(await countDistinctArchiveItems(['q1'], { need: 8, collections: ['prelinger'] }, search)).toBe(3)
  })

  it('returns 0 for empty queries or a disabled need', async () => {
    const search: ArchivePoolDeps['search'] = async () => docs(['a'])
    expect(await countDistinctArchiveItems([], { need: 8 }, search)).toBe(0)
    expect(await countDistinctArchiveItems(['q'], { need: 0 }, search)).toBe(0)
  })
})
