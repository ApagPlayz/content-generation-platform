// Unit tests for the pure TikTok helpers (src/lib/tiktok.ts). The OAuth consent
// URL and the permalink builder are the wiring most likely to break silently, so
// they get pinned here — no network, no database, mirroring the repo's colocated
// pure-function test style.

import { describe, expect, it } from 'vitest'
import { authorizeUrl, SCOPES, tiktokPermalink } from './tiktok'

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
