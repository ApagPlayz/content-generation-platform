// Unit tests for the pure visuals-sourcing gates (src/lib/truecrime/visuals.ts).
// These lock down the round-9 "starved slideshow" overhaul: the junk-title
// filter, the size/dimension quality floor, the hard-minimum enforcement, and
// the multi-query derivation from a brief.

import { describe, expect, it } from 'vitest'
import {
  deriveImageQueries,
  enforceMinUsableImages,
  isAcceptableImage,
  isJunkImageTitle,
  relevanceScore,
  topicTokens,
  MIN_IMAGE_BYTES,
  MIN_IMAGE_LONG_EDGE,
  MIN_USABLE_IMAGES,
} from './visuals'
import type { CaseBrief } from './types'
import type { CaseSubject } from '../compliance'

function makeBrief(overrides: Partial<CaseBrief> = {}): CaseBrief {
  return {
    caseName: 'The South Sea Bubble',
    wikipediaTitle: 'South Sea Company',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/South_Sea_Company',
    summary: '',
    facts: [],
    subjects: [],
    livingWarnings: [],
    ...overrides,
  }
}

function subject(overrides: Partial<CaseSubject> = {}): CaseSubject {
  return { name: 'John Blunt', role: 'other', living: false, isMinor: false, ...overrides }
}

describe('isJunkImageTitle', () => {
  it('rejects charts, graphs, diagrams and plots', () => {
    expect(isJunkImageTitle('File:South-sea-bubble-chart.png')).toBe(true)
    expect(isJunkImageTitle('File:South-sea-bubble-chart (ja).png')).toBe(true)
    expect(isJunkImageTitle('File:Share price graph 1720.png')).toBe(true)
    expect(isJunkImageTitle('File:Org diagram.png')).toBe(true)
    expect(isJunkImageTitle('File:Scatter plot.png')).toBe(true)
  })

  it('rejects logos, icons, seals, coats of arms and svgs', () => {
    expect(isJunkImageTitle('File:Commons-logo.svg')).toBe(true)
    expect(isJunkImageTitle('File:Information icon4.svg')).toBe(true)
    expect(isJunkImageTitle('File:Great Seal of the Realm.png')).toBe(true)
    expect(isJunkImageTitle('File:Coat of Arms of Great Britain.svg')).toBe(true)
    expect(isJunkImageTitle('File:Coat_of_arms_of_the_United_Kingdom.svg')).toBe(true)
    expect(isJunkImageTitle('File:Arms of the South Sea Company.svg')).toBe(true)
    expect(isJunkImageTitle('File:Some vector.svg')).toBe(true)
  })

  it('rejects locator/location maps', () => {
    expect(isJunkImageTitle('File:England locator map.png')).toBe(true)
    expect(isJunkImageTitle('File:London location map.svg')).toBe(true)
  })

  it('keeps real archival pictures', () => {
    expect(isJunkImageTitle("File:William Hogarth - The South Sea Scheme.png")).toBe(false)
    expect(isJunkImageTitle("File:Edward Matthew Ward - The South Sea Bubble.jpg")).toBe(false)
    expect(isJunkImageTitle('File:ShareCertificate SouthSeaCompany 1733.jpg')).toBe(false)
    expect(isJunkImageTitle('File:Microcosm of London Plate 101.jpg')).toBe(false)
    expect(isJunkImageTitle('File:Bubble.folly.jpg')).toBe(false)
  })
})

describe('isAcceptableImage', () => {
  it('rejects the 6.7 KB / 250 px chart thumbnail (the reported failure)', () => {
    expect(
      isAcceptableImage({ title: 'File:South-sea-bubble-chart (ja).png', width: 250, height: 180, bytes: 6739 })
    ).toBe(false)
  })

  it('rejects a file under the byte floor even at good dimensions', () => {
    expect(
      isAcceptableImage({ title: 'File:Sparse.jpg', width: 1200, height: 900, bytes: MIN_IMAGE_BYTES - 1 })
    ).toBe(false)
  })

  it('rejects an image whose long edge is under the floor', () => {
    expect(
      isAcceptableImage({ title: 'File:Tiny.jpg', width: MIN_IMAGE_LONG_EDGE - 1, height: 300, bytes: 500_000 })
    ).toBe(false)
  })

  it('keeps a real large public-domain engraving', () => {
    expect(
      isAcceptableImage({ title: 'File:William Hogarth - The South Sea Scheme.png', width: 2524, height: 2000, bytes: 12_694_749 })
    ).toBe(true)
  })

  it('keeps a tall portrait document scan on its long edge', () => {
    // 382 px wide but ~1200 px tall, 103 KB — a legitimate share certificate.
    expect(
      isAcceptableImage({ title: 'File:ShareCertificate SouthSeaCompany 1733.jpg', width: 382, height: 1200, bytes: 103_787 })
    ).toBe(true)
  })

  it('rejects junk titles regardless of size', () => {
    expect(
      isAcceptableImage({ title: 'File:Huge-chart.png', width: 4000, height: 3000, bytes: 5_000_000 })
    ).toBe(false)
  })

  it('fails open on a single unknown axis but still honours the other', () => {
    // Unknown bytes, good dimensions → accepted.
    expect(isAcceptableImage({ title: 'File:Photo.jpg', width: 1500, height: 1000, bytes: null })).toBe(true)
    // Unknown dimensions, good bytes → accepted.
    expect(isAcceptableImage({ title: 'File:Photo.jpg', width: null, height: null, bytes: 400_000 })).toBe(true)
    // Unknown dimensions but a known-tiny file → rejected.
    expect(isAcceptableImage({ title: 'File:Photo.jpg', width: null, height: null, bytes: 1000 })).toBe(false)
  })
})

describe('enforceMinUsableImages', () => {
  it('throws with a clear message below the floor', () => {
    expect(() => enforceMinUsableImages(2, 'The South Sea Bubble')).toThrowError(
      /only 2 usable images found for "The South Sea Bubble".*starved slideshow/
    )
  })

  it('singularises the message for a single image', () => {
    expect(() => enforceMinUsableImages(1, 'X')).toThrowError(/only 1 usable image found/)
  })

  it('passes at or above the floor', () => {
    expect(() => enforceMinUsableImages(MIN_USABLE_IMAGES, 'X')).not.toThrow()
    expect(() => enforceMinUsableImages(6, 'X')).not.toThrow()
  })

  it('honours a custom minimum', () => {
    expect(() => enforceMinUsableImages(3, 'X', 4)).toThrow()
    expect(() => enforceMinUsableImages(4, 'X', 4)).not.toThrow()
  })
})

describe('deriveImageQueries', () => {
  it('always leads with the case/topic name', () => {
    const qs = deriveImageQueries(makeBrief())
    expect(qs[0]).toBe('The South Sea Bubble')
  })

  it('includes non-minor subject names and skips minors', () => {
    const qs = deriveImageQueries(
      makeBrief({
        subjects: [subject({ name: 'Robert Walpole' }), subject({ name: 'Hidden Child', isMinor: true })],
      })
    )
    expect(qs).toContain('Robert Walpole')
    expect(qs).not.toContain('Hidden Child')
  })

  it('mines proper-noun phrases from the factual bullets', () => {
    const qs = deriveImageQueries(
      makeBrief({
        facts: [
          'The South Sea Company was granted a monopoly to trade with South America.',
          'Speculation drove shares to trade in Change Alley in London.',
        ],
      })
    )
    expect(qs.some((q) => /Change Alley|South America|South Sea Company/.test(q))).toBe(true)
  })

  it('surfaces relevant titles and sinks generic navbox chrome', () => {
    // A real 1929-crash brief: topic tokens include wall/street/crash/1929 plus
    // phrases mined from the facts (New York Stock Exchange, Great Depression).
    const brief = makeBrief({
      caseName: 'The Wall Street Crash of 1929',
      wikipediaTitle: 'Wall Street Crash of 1929',
      year: 1929,
      facts: [
        'The Wall Street Crash of 1929 began a decline on the New York Stock Exchange.',
        'It triggered the Great Depression across the industrialized world.',
      ],
    })
    const tokens = topicTokens(brief)
    const onTopic = relevanceScore('File:Wall Street 1929 crash crowd.jpg', tokens)
    const chrome = relevanceScore('File:United States at night satellite.png', tokens)
    const constitution = relevanceScore('File:Constitution of the United States, page 1.jpg', tokens)
    expect(onTopic).toBeGreaterThan(0)
    // Generic template chrome shares few/no topic tokens → outranked.
    expect(onTopic).toBeGreaterThan(chrome)
    expect(onTopic).toBeGreaterThan(constitution)
  })

  it('dedupes case-insensitively and caps the query count', () => {
    const qs = deriveImageQueries(
      makeBrief({
        caseName: 'South Sea Company',
        subjects: [subject({ name: 'South Sea Company' })], // dup of case name
        facts: ['A B mentioned. C D mentioned. E F mentioned. G H mentioned. I J mentioned.'],
      }),
      4
    )
    expect(qs.length).toBeLessThanOrEqual(4)
    expect(new Set(qs.map((q) => q.toLowerCase())).size).toBe(qs.length)
  })
})
