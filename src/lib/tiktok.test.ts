// Unit tests for the pure TikTok helpers (src/lib/tiktok.ts). The OAuth consent
// URL and the permalink builder are the wiring most likely to break silently, so
// they get pinned here — no network, no database, mirroring the repo's colocated
// pure-function test style.

import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  buildTikTokCaption,
  isAuthError,
  SCOPES,
  tiktokPermalink,
  TIKTOK_NATIVE_TAGS,
  TIKTOK_OPENERS,
  TIKTOK_RECONNECT_MESSAGE,
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

// Issue #56: a silently-expired/revoked TikTok login must be recognised so the
// connection can be flipped to "needs reconnect" — instead of the app painting a
// green "Connected" pill while every auto-post quietly fails, the way YouTube
// already does. isAuthError is pure, so these run with no DB or network.
describe('isAuthError', () => {
  it('detects a dead refresh token (invalid_grant / invalid_token, HTTP < 500)', () => {
    expect(isAuthError({ status: 400, tiktokError: 'invalid_grant' })).toBe(true)
    expect(isAuthError({ status: 400, tiktokError: 'invalid_token' })).toBe(true)
  })

  it('detects a 401 from an authenticated Content Posting API call', () => {
    expect(isAuthError({ status: 401 })).toBe(true)
  })

  it('detects the plain-message shapes our own code throws once the login is dead', () => {
    expect(isAuthError(new Error(TIKTOK_RECONNECT_MESSAGE))).toBe(true)
    expect(isAuthError(new Error('TikTok session expired. Reconnect it in Settings.'))).toBe(true)
    expect(isAuthError(new Error('invalid_grant'))).toBe(true)
  })

  it('does NOT flag transient / non-auth failures (5xx, rate-limit, network, our own gates)', () => {
    // A server blip that happens to echo an auth code must not flip a healthy login.
    expect(isAuthError({ status: 500, tiktokError: 'invalid_grant' })).toBe(false)
    expect(isAuthError({ status: 503 })).toBe(false)
    expect(isAuthError({ status: 429, tiktokError: 'rate_limit_exceeded' })).toBe(false)
    // Network error: no numeric status.
    expect(isAuthError(new Error('fetch failed'))).toBe(false)
    // Our own not-connected gate and a generic refresh blip are not dead grants.
    expect(isAuthError(new Error('TikTok is not connected. Connect it in Settings first.'))).toBe(false)
    expect(isAuthError(new Error('TikTok token refresh failed'))).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError('invalid_grant')).toBe(false) // a bare string, not an error object
  })
})

// The owner is non-technical: the recorded reason must read in plain English, not
// raw OAuth jargon, wherever a video didn't post because the login lapsed.
describe('TIKTOK_RECONNECT_MESSAGE', () => {
  it('tells the owner to reconnect without raw OAuth jargon', () => {
    expect(TIKTOK_RECONNECT_MESSAGE).toMatch(/reconnect/i)
    expect(TIKTOK_RECONNECT_MESSAGE).not.toMatch(/invalid_grant|401|refresh token/i)
  })
})

// Issue #88: a TikTok caption that byte-matches the YouTube metadata is a named
// shadowban trigger. buildTikTokCaption must produce a caption that is always
// distinct from the plain YouTube title — via a per-video human opener + native
// #fyp-style tags — while staying deterministic (so re-publish is idempotent).
describe('buildTikTokCaption', () => {
  const hashtags = ['truecrime', 'mystery']

  it('is never the bare YouTube title — it leads with a human opener', () => {
    const title = 'The Zodiac cipher nobody could crack'
    const caption = buildTikTokCaption({ title, hashtags, videoId: 'v1' })
    expect(caption).not.toBe(title)
    expect(TIKTOK_OPENERS.some((o) => caption.startsWith(o))).toBe(true)
  })

  it('differs from the reconstructed YouTube title + description block', () => {
    const title = 'A quiet town, a 40-year secret'
    // How publish.ts builds the YouTube side: title, then description + tags + #Shorts.
    const youtubeText = [title, 'The full case, explained.', '#truecrime #mystery', '#Shorts']
      .filter(Boolean)
      .join('\n\n')
    const caption = buildTikTokCaption({ title, hashtags, videoId: 'v2' })
    expect(caption).not.toBe(youtubeText)
    expect(caption).not.toBe(title)
  })

  it('includes native TikTok discovery tags and never YouTube-only #Shorts', () => {
    const caption = buildTikTokCaption({ title: 'x', hashtags, videoId: 'v3' })
    for (const t of TIKTOK_NATIVE_TAGS) expect(caption).toContain(`#${t}`)
    expect(caption).not.toMatch(/#Shorts\b/i)
  })

  it('keeps the video hashtags, after the native tags', () => {
    const caption = buildTikTokCaption({ title: 'x', hashtags, videoId: 'v4' })
    expect(caption).toContain('#truecrime')
    expect(caption.indexOf('#fyp')).toBeLessThan(caption.indexOf('#truecrime'))
  })

  it('is deterministic — the same video always gets the same caption', () => {
    const a = buildTikTokCaption({ title: 'same', hashtags, videoId: 'stable-id' })
    const b = buildTikTokCaption({ title: 'same', hashtags, videoId: 'stable-id' })
    expect(a).toBe(b)
  })

  it('rotates the opener across different videos (not always the same one)', () => {
    const openers = new Set(
      Array.from({ length: 25 }, (_, i) =>
        TIKTOK_OPENERS.find((o) => buildTikTokCaption({ title: 't', videoId: `id-${i}` }).startsWith(o))
      )
    )
    expect(openers.size).toBeGreaterThan(1)
  })

  it('dedupes a native tag the video already carries (case-insensitive)', () => {
    const caption = buildTikTokCaption({ title: 'x', hashtags: ['FYP', 'case'], videoId: 'v5' })
    expect((caption.match(/#fyp\b/gi) || []).length).toBe(1)
    expect(caption).toContain('#case')
  })

  it('handles an empty title and no hashtags — still distinct + native tags present', () => {
    const caption = buildTikTokCaption({ title: '', videoId: 'v6' })
    expect(caption).toContain('#fyp')
    expect(caption).not.toMatch(/ {2,}/) // no doubled spaces from an empty title
  })

  it('never exceeds TikTok’s 2200-char caption limit', () => {
    const caption = buildTikTokCaption({
      title: 'A'.repeat(4000),
      hashtags: Array.from({ length: 300 }, (_, i) => `tag${i}`),
      videoId: 'v7',
    })
    expect(caption.length).toBeLessThanOrEqual(2200)
  })

  // The highest-stakes niche: a true-crime opener that asserted guilt would defeat
  // the whole defamation guard. No opener may imply a person is guilty.
  it('has no opener that implies guilt (true-crime safety)', () => {
    for (const o of TIKTOK_OPENERS) {
      expect(o).not.toMatch(/guilty|killer|murderer|did it|criminal|convict/i)
    }
  })
})
