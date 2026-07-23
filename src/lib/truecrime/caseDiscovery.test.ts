// Unit tests for the archive.org inventory probe. countDistinctArchiveItems
// (archiveFootage.ts) is still used by the per-video footage stage to size its
// still pool; the OBSOLETE discovery media-richness gate (pickMediaRichCandidate
// + era floor) it once fed has been retired — with archiveStillsOnly those
// counts are ~zero for every topic, so discovery now gates on Wikipedia image
// viability instead (see selectViableCandidate in ../pipeline/coverage.test.ts
// and countUsableArticleImages in ./visuals.ts). The default discovery floor is
// now DEFAULT_MIN_USABLE_IMAGES.

import { describe, expect, it } from 'vitest'
import { DEFAULT_MIN_USABLE_IMAGES } from './caseDiscovery'
import { MIN_USABLE_IMAGES } from './visuals'
import { countDistinctArchiveItems, RELAXED_ARCHIVE_COLLECTIONS } from './archiveFootage'
import type { ArchiveDoc, ArchivePoolDeps } from './archiveFootage'

describe('DEFAULT_MIN_USABLE_IMAGES', () => {
  it('is the visuals-stage usable-image floor (5) — one gate, no drift', () => {
    expect(DEFAULT_MIN_USABLE_IMAGES).toBe(MIN_USABLE_IMAGES)
    expect(DEFAULT_MIN_USABLE_IMAGES).toBe(5)
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
