// Unit tests for the pure Meta/Facebook helpers (src/lib/meta.ts). The consent
// URL, the permalink builder and the Graph error parser are the wiring most
// likely to break silently, so they get pinned here — no network, no database,
// mirroring the repo's colocated pure-function test style (see tiktok.test.ts).

import { describe, expect, it } from 'vitest'
import { authorizeUrl, facebookPermalink, graphError, SCOPES } from './meta'

describe('authorizeUrl', () => {
  const url = authorizeUrl('app123', 'http://localhost:3000/api/auth/meta/callback', 'connect')

  it('points at the Facebook v21 login dialog', () => {
    expect(url.startsWith('https://www.facebook.com/v21.0/dialog/oauth?')).toBe(true)
  })

  it('carries the app id, redirect, response_type and state', () => {
    const q = new URL(url).searchParams
    expect(q.get('client_id')).toBe('app123')
    expect(q.get('redirect_uri')).toBe('http://localhost:3000/api/auth/meta/callback')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('state')).toBe('connect')
  })

  it('requests the Page-management scopes needed to post a Reel', () => {
    const q = new URL(url).searchParams
    expect(q.get('scope')).toBe(SCOPES.join(','))
    expect(SCOPES).toContain('pages_manage_posts')
  })
})

describe('facebookPermalink', () => {
  it('builds a public /reel/ URL from the video id when Meta gave no permalink', () => {
    expect(facebookPermalink('123')).toBe('https://www.facebook.com/reel/123')
    expect(facebookPermalink('123', null)).toBe('https://www.facebook.com/reel/123')
  })

  it('uses the permalink Meta returned when it is an absolute URL', () => {
    expect(facebookPermalink('123', 'https://www.facebook.com/reel/999')).toBe(
      'https://www.facebook.com/reel/999'
    )
  })

  it('absolutizes a site-relative permalink from Meta', () => {
    expect(facebookPermalink('123', '/reel/999/')).toBe('https://www.facebook.com/reel/999/')
  })
})

describe('graphError', () => {
  it('is null for a clean response', () => {
    expect(graphError({ data: [] })).toBe(null)
    expect(graphError(null)).toBe(null)
    expect(graphError('nope')).toBe(null)
  })

  it('prefers the user-facing message when Meta provides one', () => {
    expect(
      graphError({ error: { message: 'raw', error_user_msg: 'Reconnect your Page' } })
    ).toBe('Reconnect your Page')
  })

  it('falls back to the developer message', () => {
    expect(graphError({ error: { message: 'Invalid OAuth access token' } })).toBe(
      'Invalid OAuth access token'
    )
  })
})
