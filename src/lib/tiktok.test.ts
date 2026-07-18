// Unit tests for the pure TikTok helpers (src/lib/tiktok.ts). The OAuth consent
// URL and the permalink builder are the wiring most likely to break silently, so
// they get pinned here — no network, no database, mirroring the repo's colocated
// pure-function test style.

import { describe, expect, it } from 'vitest'
import { authorizeUrl, isAuthError, SCOPES, tiktokPermalink, TIKTOK_RECONNECT_MESSAGE } from './tiktok'

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
