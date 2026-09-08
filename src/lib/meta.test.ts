// Unit tests for the pure Meta / Facebook Reels helpers (src/lib/meta.ts). The
// OAuth consent URL, the reel permalink, the Graph error parser, the Page picker
// and the auth-error classifier are the wiring most likely to break silently, so
// they get pinned here — no network, no database, mirroring the repo's colocated
// pure-function test style (see tiktok.test.ts).

import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  facebookReelPermalink,
  FACEBOOK_RECONNECT_MESSAGE,
  isAuthError,
  parseFbError,
  SCOPES,
  selectPage,
} from './meta'

describe('authorizeUrl', () => {
  const url = authorizeUrl('app123', 'http://localhost:3000/api/auth/facebook/callback', 'connect')

  it('points at the Facebook OAuth consent dialog (www, versioned) — not graph', () => {
    expect(url.startsWith('https://www.facebook.com/v21.0/dialog/oauth?')).toBe(true)
    expect(url).not.toContain('graph.facebook.com')
  })

  it('carries the app id, redirect, response_type and state', () => {
    const q = new URL(url).searchParams
    expect(q.get('client_id')).toBe('app123')
    expect(q.get('redirect_uri')).toBe('http://localhost:3000/api/auth/facebook/callback')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('state')).toBe('connect')
  })

  it('requests the scopes needed to list a Page and post a reel to it', () => {
    const q = new URL(url).searchParams
    expect(q.get('scope')).toBe(SCOPES.join(','))
    expect(SCOPES).toContain('pages_show_list')
    expect(SCOPES).toContain('pages_manage_posts')
  })
})

describe('facebookReelPermalink', () => {
  it('builds a public reel URL from the video id', () => {
    expect(facebookReelPermalink('123')).toBe('https://www.facebook.com/reel/123')
  })

  it('falls back to facebook.com when there is no video id yet', () => {
    expect(facebookReelPermalink()).toBe('https://www.facebook.com')
    expect(facebookReelPermalink('')).toBe('https://www.facebook.com')
  })
})

describe('parseFbError', () => {
  it('extracts message, code and subcode from a Graph error envelope', () => {
    const parsed = parseFbError({
      error: { message: 'Error validating access token', code: 190, error_subcode: 463 },
    })
    expect(parsed).toEqual({ message: 'Error validating access token', code: 190, subcode: 463 })
  })

  it('returns null for a non-error payload', () => {
    expect(parseFbError({ video_id: 'abc', upload_url: 'https://…' })).toBeNull()
    expect(parseFbError({})).toBeNull()
    expect(parseFbError(null)).toBeNull()
    expect(parseFbError('nope')).toBeNull()
  })
})

describe('selectPage', () => {
  it('returns the first Page id + token from /me/accounts', () => {
    const page = selectPage({
      data: [
        { id: '111', name: 'My Page', access_token: 'pagetoken' },
        { id: '222', name: 'Other', access_token: 'other' },
      ],
    })
    expect(page).toEqual({ id: '111', name: 'My Page', access_token: 'pagetoken' })
  })

  it('defaults a missing Page name so the Settings pill still renders', () => {
    expect(selectPage({ data: [{ id: '111', access_token: 't' }] }).name).toBe('Facebook Page')
  })

  it('throws a plain-language "create a Page" error when the account manages none', () => {
    expect(() => selectPage({ data: [] })).toThrow(/no facebook page/i)
    expect(() => selectPage(null)).toThrow(/no facebook page/i)
    // A profile-only login (id but no page token) is not a usable Page either.
    expect(() => selectPage({ data: [{ id: '111' }] })).toThrow(/no facebook page/i)
  })
})

// A silently-expired/revoked Facebook login must be recognised so the connection
// can be flipped to "needs reconnect" — instead of the app painting a green
// "Connected" pill while every auto-post quietly fails, the way YouTube/TikTok
// already do. isAuthError is pure, so these run with no DB or network.
describe('isAuthError', () => {
  it('detects an expired/invalid Graph token (code 190, any subcode, HTTP < 500)', () => {
    expect(isAuthError({ status: 400, fbCode: 190 })).toBe(true)
    expect(isAuthError({ fbCode: 190, fbSubcode: 463 })).toBe(true)
    expect(isAuthError({ fbCode: 190, fbSubcode: 460 })).toBe(true)
    expect(isAuthError({ fbCode: 190, fbSubcode: 467 })).toBe(true)
  })

  it('detects a session/permission failure that needs re-consent (code 102/10/2xx)', () => {
    expect(isAuthError({ fbCode: 102 })).toBe(true)
    expect(isAuthError({ fbCode: 10 })).toBe(true)
    expect(isAuthError({ fbCode: 200 })).toBe(true)
  })

  it('detects a bare 401/403 from the upload host', () => {
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ status: 403 })).toBe(true)
  })

  it('detects our own already-decided reconnect message', () => {
    expect(isAuthError(new Error(FACEBOOK_RECONNECT_MESSAGE))).toBe(true)
  })

  it('does NOT flag rate-limit codes (4/17/32/341/613) — a healthy login, retry later', () => {
    for (const fbCode of [4, 17, 32, 341, 613]) {
      expect(isAuthError({ fbCode })).toBe(false)
    }
  })

  it('does NOT flag a transient 5xx, even one echoing an auth-ish code', () => {
    expect(isAuthError({ status: 500, fbCode: 190 })).toBe(false)
    expect(isAuthError({ status: 503 })).toBe(false)
  })

  it('does NOT flag network errors, the not-connected message, or junk', () => {
    expect(isAuthError(new Error('fetch failed'))).toBe(false)
    expect(isAuthError(new Error('Facebook is not connected. Connect it in Settings first.'))).toBe(
      false
    )
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError('190')).toBe(false)
  })
})

describe('FACEBOOK_RECONNECT_MESSAGE', () => {
  it('reads as plain English with no raw OAuth jargon', () => {
    expect(FACEBOOK_RECONNECT_MESSAGE).toMatch(/reconnect/i)
    expect(FACEBOOK_RECONNECT_MESSAGE).not.toMatch(/OAuthException|190|access.?token/i)
  })
})
