// Tests for the relevant moving-clip layer: the strict relevance filter, clip
// beat distribution, attribution formatting, the combined media floor, and the
// resolveBeatClips orchestration over injected (offline) source seams.

import { describe, expect, it } from 'vitest'
import {
  appendAttribution,
  enforceMediaFloor,
  formatAttributionLines,
  isRelevantClipText,
  pickClipBeatIndices,
  relevanceTokens,
  resolveBeatClips,
  MIN_PHOTOS,
  type ClipResolveDeps,
} from './clips'
import type { ArchiveDoc } from '../archiveFootage'
import type { CaseBrief, ClipAttribution, F10FactoryConfig, F10Script, ScriptBeat } from '../types'
import { MIN_USABLE_IMAGES } from '../visuals'

function makeBrief(overrides: Partial<CaseBrief> = {}): CaseBrief {
  return {
    caseName: 'The Hindenburg Disaster',
    wikipediaTitle: 'Hindenburg disaster',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Hindenburg_disaster',
    summary: '',
    facts: [],
    subjects: [],
    year: 1937,
    livingWarnings: [],
    ...overrides,
  }
}

function makeBeats(n: number): ScriptBeat[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `beat-${i}`,
    index: i,
    narration: '',
    targetSeconds: 10,
    visualCue: '',
    cutIntervalSec: 0,
    musicIntensity: 0,
    complianceFlag: 'factual' as const,
  }))
}

function makeScript(n: number): F10Script {
  return {
    caseName: 'The Hindenburg Disaster',
    subjects: [],
    narration: 'x',
    title: 't',
    description: 'A short doc.',
    hashtags: [],
    beats: makeBeats(n),
  } as F10Script
}

describe('relevanceTokens', () => {
  it('drops the bare event year so a year-only title match cannot pass', () => {
    const toks = relevanceTokens(makeBrief())
    expect(toks.has('hindenburg')).toBe(true)
    expect(toks.has('disaster')).toBe(true)
    expect(toks.has('1937')).toBe(false)
  })
})

describe('isRelevantClipText', () => {
  const tokens = relevanceTokens(makeBrief())

  it('accepts a title that shares the topic tokens', () => {
    expect(isRelevantClipText('Hindenburg disaster newsreel 1937', tokens, 1)).toBe(true)
  })

  it('rejects an off-topic title (a generic era reel)', () => {
    expect(isRelevantClipText('1937 vintage cooking show', tokens, 1)).toBe(false)
    expect(isRelevantClipText('Prelinger ephemeral film reel', tokens, 1)).toBe(false)
  })

  it('a year-only match is NOT enough (year is excluded from the tokens)', () => {
    expect(isRelevantClipText('newsreel 1937', tokens, 1)).toBe(false)
  })

  it('honours a higher minimum token requirement', () => {
    // "Hindenburg" alone is 1 token — needs 2 distinct topic tokens to pass.
    expect(isRelevantClipText('The Hindenburg airship', tokens, 2)).toBe(false)
    expect(isRelevantClipText('Hindenburg disaster footage', tokens, 2)).toBe(true)
  })
})

describe('pickClipBeatIndices', () => {
  it('spreads clips across the beats rather than clumping', () => {
    const idx = pickClipBeatIndices([0, 1, 2, 3, 4, 5], 2)
    expect(idx).toHaveLength(2)
    expect(new Set(idx).size).toBe(2)
    // Not both at the very start.
    expect(idx[0]).not.toBe(idx[1])
  })

  it('returns every beat when asked for at least as many as exist', () => {
    expect(pickClipBeatIndices([0, 1, 2], 5)).toEqual([0, 1, 2])
  })

  it('returns [] for zero count or no beats', () => {
    expect(pickClipBeatIndices([0, 1, 2], 0)).toEqual([])
    expect(pickClipBeatIndices([], 3)).toEqual([])
  })

  it('never returns duplicate beat indices', () => {
    const idx = pickClipBeatIndices([0, 1, 2, 3], 3)
    expect(new Set(idx).size).toBe(idx.length)
  })
})

describe('attribution', () => {
  const attrs: ClipAttribution[] = [
    { source: 'archive', title: 'Hindenburg Disaster Newsreel', url: 'https://archive.org/details/x' },
    { source: 'youtube', title: 'Hindenburg 1937', channel: 'British Pathé', url: 'https://youtu.be/abc' },
  ]

  it('formats a credit line per clip, with channel when present', () => {
    const lines = formatAttributionLines(attrs)
    expect(lines[0]).toBe('Footage: Hindenburg Disaster Newsreel (https://archive.org/details/x)')
    expect(lines[1]).toBe('Footage: Hindenburg 1937 — British Pathé (https://youtu.be/abc)')
  })

  it('appends a credits block to the description and is idempotent', () => {
    const once = appendAttribution('A short doc.', attrs)
    expect(once).toContain('Footage credits:')
    expect(once).toContain('British Pathé')
    // Re-running does not stack a second block.
    const twice = appendAttribution(once, attrs)
    expect(twice.match(/Footage credits:/g)).toHaveLength(1)
  })

  it('is a no-op with no attributions', () => {
    expect(appendAttribution('desc', [])).toBe('desc')
  })
})

describe('enforceMediaFloor', () => {
  it('passes when photos anchor the video and the total clears the floor', () => {
    expect(() => enforceMediaFloor(MIN_USABLE_IMAGES, 0, 'X')).not.toThrow()
    expect(() => enforceMediaFloor(MIN_PHOTOS, 2, 'X')).not.toThrow() // 3 photos + 2 clips = 5
  })

  it('fails when photos fall below the backbone minimum, even with clips', () => {
    expect(() => enforceMediaFloor(2, 5, 'X')).toThrowError(/photos are the backbone/)
  })

  it('fails when the combined total is below the floor', () => {
    expect(() => enforceMediaFloor(MIN_PHOTOS, 1, 'X')).toThrowError(/starved slideshow/) // 3+1=4 < 5
  })

  it('lets clips count toward the total (3 photos + 2 clips reaches 5)', () => {
    expect(() => enforceMediaFloor(3, 2, 'X')).not.toThrow()
  })
})

// ── resolveBeatClips orchestration (offline via injected deps) ───────────────

function config(overrides: Partial<F10FactoryConfig> = {}): F10FactoryConfig {
  return { clipsEnabled: true, maxClipBeats: 2, clipSources: ['archive'], clipRelevanceMinTokens: 1, ...overrides }
}

describe('resolveBeatClips', () => {
  it('is empty when clips are disabled', async () => {
    const res = await resolveBeatClips('v', makeScript(6), makeBrief(), config({ clipsEnabled: false }))
    expect(res.beatClips).toEqual({})
    expect(res.attributions).toEqual([])
  })

  it('filters OFF-TOPIC and non-movie archive docs before ever downloading', async () => {
    const resolvedDocs: string[] = []
    const docs: ArchiveDoc[] = [
      { identifier: 'rel', title: 'Hindenburg disaster newsreel', mediatype: 'movies' },
      { identifier: 'offtopic', title: 'A 1937 cooking demonstration', mediatype: 'movies' },
      { identifier: 'photo', title: 'Hindenburg disaster photograph', mediatype: 'image' },
    ]
    const deps: ClipResolveDeps = {
      searchArchive: async () => docs,
      resolveArchive: async (doc) => {
        resolvedDocs.push(doc.identifier!)
        return true
      },
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
    }
    const res = await resolveBeatClips('v', makeScript(6), makeBrief(), config(), deps)
    // Only the on-topic MOVIE doc was ever passed to the downloader.
    expect(resolvedDocs).toEqual(['rel'])
    expect(Object.keys(res.beatClips)).toHaveLength(1)
    expect(res.attributions[0].title).toContain('Hindenburg')
    expect(res.visuals[0].kind).toBe('video')
    expect(res.visuals[0].license).toBe('fair_use')
  })

  it('caps the number of clip-beats at maxClipBeats', async () => {
    const docs: ArchiveDoc[] = [
      { identifier: 'a', title: 'Hindenburg disaster reel one', mediatype: 'movies' },
      { identifier: 'b', title: 'Hindenburg disaster reel two', mediatype: 'movies' },
      { identifier: 'c', title: 'Hindenburg disaster reel three', mediatype: 'movies' },
    ]
    const deps: ClipResolveDeps = {
      searchArchive: async () => docs,
      resolveArchive: async () => true,
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
    }
    const res = await resolveBeatClips('v', makeScript(6), makeBrief(), config({ maxClipBeats: 2 }), deps)
    expect(Object.keys(res.beatClips)).toHaveLength(2)
  })

  it('falls through to YouTube when archive resolves nothing, and dedups sources', async () => {
    const deps: ClipResolveDeps = {
      searchArchive: async () => [{ identifier: 'a', title: 'Hindenburg disaster', mediatype: 'movies' }],
      resolveArchive: async () => false, // archive download fails
      searchYouTube: async () => [
        { id: 'y1', title: 'Hindenburg disaster footage', channel: 'British Pathé', url: 'https://youtu.be/y1', durationSec: 120 },
        { id: 'y1', title: 'dup', channel: 'x', url: 'https://youtu.be/y1', durationSec: 120 }, // dup id
      ],
      downloadYouTube: async () => true,
    }
    const res = await resolveBeatClips(
      'v',
      makeScript(6),
      makeBrief(),
      config({ clipSources: ['archive', 'youtube'] }),
      deps
    )
    expect(Object.keys(res.beatClips)).toHaveLength(1)
    expect(res.attributions[0].source).toBe('youtube')
    expect(res.attributions[0].channel).toBe('British Pathé')
  })

  it('excludes a compilation that only mentions the topic in its DESCRIPTION (title must match)', async () => {
    const resolvedDocs: string[] = []
    const docs: ArchiveDoc[] = [
      // A whole series whose title never names the topic — only the blurb does.
      { identifier: 'series', title: 'The Time Tunnel - Complete Series 1966', description: 'One episode depicts the Titanic disaster.', mediatype: 'movies' },
      { identifier: 'onreel', title: 'Titanic disaster newsreel', mediatype: 'movies' },
    ]
    const deps: ClipResolveDeps = {
      searchArchive: async () => docs,
      resolveArchive: async (doc) => {
        resolvedDocs.push(doc.identifier!)
        return true
      },
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
    }
    const brief = makeBrief({ caseName: 'The Sinking of the Titanic', wikipediaTitle: 'Sinking of the Titanic', year: 1912 })
    const res = await resolveBeatClips('v', makeScript(6), brief, config(), deps)
    // The description-only compilation is never downloaded; only the titled reel is.
    expect(resolvedDocs).toEqual(['onreel'])
    expect(Object.keys(res.beatClips)).toHaveLength(1)
  })

  it('never downloads a candidate the AI judge rejects (fiction/off-topic)', async () => {
    const resolvedDocs: string[] = []
    const docs: ArchiveDoc[] = [
      { identifier: 'real', title: 'Dust Bowl newsreel', mediatype: 'movies' },
      { identifier: 'fiction', title: 'The Grapes of Wrath', mediatype: 'movies' },
    ]
    const deps: ClipResolveDeps = {
      searchArchive: async () => docs,
      resolveArchive: async (doc) => {
        resolvedDocs.push(doc.identifier!)
        return true
      },
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
      // Injected judge: reject any candidate whose title names the fiction film.
      judge: async (_topic, _angle, cands) =>
        cands.map((c, i) => ({ index: i, keep: !/grapes of wrath/i.test(c.title) })),
    }
    const brief = makeBrief({ caseName: 'The Dust Bowl', wikipediaTitle: 'Dust Bowl', year: 1934 })
    const res = await resolveBeatClips('v', makeScript(6), brief, config(), deps)
    expect(resolvedDocs).toEqual(['real']) // the fiction feature was vetted out
    expect(Object.keys(res.beatClips)).toHaveLength(1)
  })

  it('is empty (photos-only path) when the judge rejects everything', async () => {
    const deps: ClipResolveDeps = {
      searchArchive: async () => [{ identifier: 'a', title: 'Hindenburg disaster', mediatype: 'movies' }],
      resolveArchive: async () => true,
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
      judge: async (_t, _a, cands) => cands.map((_, i) => ({ index: i, keep: false })),
    }
    const res = await resolveBeatClips('v', makeScript(6), makeBrief(), config(), deps)
    expect(res.beatClips).toEqual({})
  })

  it('is empty (photos-only path) when nothing relevant resolves', async () => {
    const deps: ClipResolveDeps = {
      searchArchive: async () => [{ identifier: 'z', title: 'unrelated travelogue', mediatype: 'movies' }],
      resolveArchive: async () => true,
      searchYouTube: async () => [],
      downloadYouTube: async () => false,
    }
    const res = await resolveBeatClips('v', makeScript(6), makeBrief(), config(), deps)
    expect(res.beatClips).toEqual({})
  })
})
