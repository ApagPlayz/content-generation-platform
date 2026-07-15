import { describe, expect, it } from 'vitest'
import { isAuthError, YT_RECONNECT_MESSAGE } from './youtube'

// Issue #31: a silently-expired YouTube login (Google invalid_grant / 401) must
// be recognised so the connection can be flipped to "needs reconnect" — instead
// of the app painting a green "Connected" pill while every publish quietly fails.
// isAuthError is pure, so these run with no DB or network, matching the repo's
// colocated pure-function test style.
describe('isAuthError', () => {
  it('detects a dead refresh token (invalid_grant, HTTP 400 on refresh)', () => {
    expect(
      isAuthError({ response: { status: 400, data: { error: 'invalid_grant' } } })
    ).toBe(true)
  })

  it('detects invalid_grant reported only in error_description', () => {
    expect(
      isAuthError({
        response: {
          status: 400,
          data: {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          },
        },
      })
    ).toBe(true)
  })

  it('detects a 401 from the API call itself (response.status / status / code)', () => {
    expect(isAuthError({ response: { status: 401 } })).toBe(true)
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ code: 401 })).toBe(true)
    expect(isAuthError({ code: '401' })).toBe(true)
  })

  it('detects the plain-Error shapes google-auth-library throws', () => {
    expect(isAuthError(new Error('invalid_grant'))).toBe(true)
    expect(isAuthError(new Error('Token has been expired or revoked.'))).toBe(true)
    expect(isAuthError(new Error('No refresh token is set.'))).toBe(true)
  })

  it('does NOT flag transient / non-auth failures (quota, 5xx, network, our own errors)', () => {
    expect(isAuthError({ response: { status: 403, data: { error: 'quotaExceeded' } } })).toBe(false)
    expect(isAuthError({ response: { status: 500 } })).toBe(false)
    expect(isAuthError(new Error('getaddrinfo ENOTFOUND'))).toBe(false)
    expect(isAuthError(new Error('daily upload quota reached (6/day)'))).toBe(false)
    expect(isAuthError(new Error('YouTube did not return a video id'))).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError('invalid_grant')).toBe(false) // a bare string, not an error object
  })
})

// The owner is non-technical: the recorded reason must read in plain English, not
// raw OAuth jargon, wherever a video didn't post because the login lapsed.
describe('YT_RECONNECT_MESSAGE', () => {
  it('tells the owner to reconnect without raw OAuth jargon', () => {
    expect(YT_RECONNECT_MESSAGE).toMatch(/reconnect/i)
    expect(YT_RECONNECT_MESSAGE).not.toMatch(/invalid_grant|401|refresh token/i)
  })
})
