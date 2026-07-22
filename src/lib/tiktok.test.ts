// Unit tests for the pure TikTok helpers (src/lib/tiktok.ts). The OAuth consent
// URL and the permalink builder are the wiring most likely to break silently, so
// they get pinned here — no network, no database, mirroring the repo's colocated
// pure-function test style.

import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  buildTikTokCaption,
  captionVariant,
  SCOPES,
  TIKTOK_NATIVE_TAGS,
  TIKTOK_OPENERS,
  tiktokPermalink,
} from './tiktok'

describe('authorizeUrl', () => {
  const url = authorizeUrl('awkey123', 'http://localhost:3000/api/auth/tiktok/callback', 'connect')

  it('points at the TikTok v2 consent endpoint', () => {
    expect(url.startsWith('https://www.tiktok.com/v2/auth/authorize/?')).toBe(true)
  })

  it('carries the client key, redirect, response_type and state', () => {
    const q = new URL(url).searchParams
    expect(q.get('client_key')).toBe('awkey123')
    expect(q.get('redirect_uri')).toBe('http://localhost:3000/api/auth/tiktok/callback')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('state')).toBe('connect')
  })

  it('requests the publish scope needed to post', () => {
    const q = new URL(url).searchParams
    expect(q.get('scope')).toBe(SCOPES.join(','))
    expect(SCOPES).toContain('video.publish')
  })
})

describe('tiktokPermalink', () => {
  it('builds a public video URL from handle + post id', () => {
    expect(tiktokPermalink('creator', '123')).toBe('https://www.tiktok.com/@creator/video/123')
  })

  it('tolerates a leading @ on the handle', () => {
    expect(tiktokPermalink('@creator', '123')).toBe('https://www.tiktok.com/@creator/video/123')
  })

  it('falls back to the profile URL when there is no post id yet', () => {
    expect(tiktokPermalink('creator')).toBe('https://www.tiktok.com/@creator')
  })

  it('still returns a usable URL when only a post id is known', () => {
    expect(tiktokPermalink('', '123')).toBe('https://www.tiktok.com/video/123')
  })
})

describe('captionVariant', () => {
  it('is deterministic for the same seed + bucket count', () => {
    expect(captionVariant('video-abc', 6)).toBe(captionVariant('video-abc', 6))
  })

  it('always lands within [0, buckets)', () => {
    for (const seed of ['a', 'video-1', 'zzz-999', '', '@handle']) {
      const v = captionVariant(seed, 6)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
    }
  })

  it('returns 0 for a non-positive bucket count', () => {
    expect(captionVariant('anything', 0)).toBe(0)
    expect(captionVariant('anything', -3)).toBe(0)
  })
})

describe('buildTikTokCaption', () => {
  const base = { title: 'The unsolved case of the missing lighthouse keeper', hashtags: ['truecrime', 'mystery'] }

  it('is deterministic — the same video yields the same caption every time', () => {
    const a = buildTikTokCaption({ ...base, seed: 'vid-1' })
    const b = buildTikTokCaption({ ...base, seed: 'vid-1' })
    expect(a).toBe(b)
  })

  it('varies the caption across different videos', () => {
    const captions = new Set(
      ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((seed) => buildTikTokCaption({ ...base, seed }))
    )
    // Different seeds should not all collapse to one identical caption.
    expect(captions.size).toBeGreaterThan(1)
  })

  it('always carries a TikTok-native discovery tag YouTube never uses', () => {
    const caption = buildTikTokCaption({ ...base, seed: 'vid-1' })
    expect(TIKTOK_NATIVE_TAGS.some((t) => caption.includes(`#${t}`))).toBe(true)
  })

  it('opens with one of the natural hooks', () => {
    const caption = buildTikTokCaption({ ...base, seed: 'vid-1' })
    expect(TIKTOK_OPENERS.some((o) => caption.startsWith(o))).toBe(true)
  })

  it('keeps the supplied hashtags (normalised, deduped, lowercased)', () => {
    const caption = buildTikTokCaption({
      title: 'Hi',
      hashtags: ['#TrueCrime', 'truecrime', ' Mystery '],
      seed: 'vid-9',
    })
    expect(caption).toContain('#truecrime')
    expect(caption).toContain('#mystery')
    // The duplicate (#TrueCrime vs truecrime) collapses to a single tag.
    expect(caption.match(/#truecrime/g)?.length).toBe(1)
  })

  it('is never byte-identical to the YouTube title or description', () => {
    const title = 'The unsolved case of the missing lighthouse keeper'
    const description = `${title}\n\n#truecrime #mystery #Shorts`
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const caption = buildTikTokCaption({ title, hashtags: ['truecrime', 'mystery'], seed, avoid: [title, description] })
      expect(caption).not.toBe(title)
      expect(caption).not.toBe(description)
    }
  })

  it('even dodges a caption that would otherwise exactly match an avoided string', () => {
    // Force a collision: pre-compute a caption, then demand it be avoided.
    const collision = buildTikTokCaption({ title: 'Hook', hashtags: ['fyp'], seed: 'seed-x' })
    const dodged = buildTikTokCaption({ title: 'Hook', hashtags: ['fyp'], seed: 'seed-x', avoid: [collision] })
    expect(dodged).not.toBe(collision)
  })

  it('never exceeds the 2200-character TikTok caption limit', () => {
    const caption = buildTikTokCaption({
      title: 'x'.repeat(5000),
      hashtags: ['tag'],
      seed: 'long',
    })
    expect(caption.length).toBeLessThanOrEqual(2200)
  })
})
