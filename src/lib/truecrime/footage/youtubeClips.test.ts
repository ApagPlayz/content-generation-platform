// Pure-helper tests for the YouTube clip source: yt-dlp JSON parsing, the
// channel-authority ranking, and candidate ordering. No network / no yt-dlp.

import { describe, expect, it } from 'vitest'
import {
  authorityScore,
  parseYtSearchJson,
  rankYouTubeCandidates,
  type YouTubeCandidate,
} from './youtubeClips'

describe('parseYtSearchJson', () => {
  it('parses newline-delimited yt-dlp JSON into candidates', () => {
    const stdout = [
      JSON.stringify({ id: 'abc', title: 'Hindenburg disaster', channel: 'British Pathé', duration: 120 }),
      JSON.stringify({ id: 'def', title: 'News report', uploader: 'AP Archive', duration: 60, url: 'https://youtu.be/def' }),
      '', // blank line ignored
      'not json', // garbage line ignored
      JSON.stringify({ title: 'no id — skipped' }),
    ].join('\n')
    const cands = parseYtSearchJson(stdout)
    expect(cands).toHaveLength(2)
    expect(cands[0]).toMatchObject({ id: 'abc', channel: 'British Pathé', durationSec: 120 })
    // Falls back to uploader for channel and synthesises a watch URL when absent.
    expect(cands[1].channel).toBe('AP Archive')
    expect(cands[0].url).toBe('https://www.youtube.com/watch?v=abc')
    expect(cands[1].url).toBe('https://youtu.be/def')
  })

  it('treats a missing/zero duration as null', () => {
    const cands = parseYtSearchJson(JSON.stringify({ id: 'x', title: 't' }))
    expect(cands[0].durationSec).toBeNull()
  })
})

describe('authorityScore', () => {
  it('scores news / official / government channels above random uploaders', () => {
    expect(authorityScore('ABC News')).toBe(1)
    expect(authorityScore('British Pathé')).toBe(0) // no authority keyword in the name
    expect(authorityScore('Reuters')).toBe(1)
    expect(authorityScore('C-SPAN')).toBe(1)
    expect(authorityScore('Some Random Guy')).toBe(0)
  })
})

describe('rankYouTubeCandidates', () => {
  it('puts authoritative channels first, then longer sources', () => {
    const cands: YouTubeCandidate[] = [
      { id: '1', title: 'a', channel: 'Random Uploads', url: 'u1', durationSec: 500 },
      { id: '2', title: 'b', channel: 'BBC News', url: 'u2', durationSec: 60 },
      { id: '3', title: 'c', channel: 'PBS', url: 'u3', durationSec: 300 },
    ]
    const ranked = rankYouTubeCandidates(cands)
    // The two authoritative channels come first (longer one leads), random last.
    expect(ranked.map((c) => c.id)).toEqual(['3', '2', '1'])
  })
})
