// Unit tests for describeAutoPublishFailure (src/lib/tools/publish.ts).
// Issue #15: a hands-off agent that finishes a video but can't publish it used
// to leave the video silently in 'approved'. maybeAutoPublish now records a
// 'failed' Post with the reason, and the dashboard renders it through this pure
// humanizer. The DB wiring is exercised end-to-end via the app; the interesting
// pure logic — turning a raw reason into plain language for a non-technical
// owner — is tested here, no database, matching the repo's colocated style.

import { describe, expect, it } from 'vitest'
import { describeAutoPublishFailure } from './publish'

describe('describeAutoPublishFailure', () => {
  it('explains a missing YouTube connection and points at Settings', () => {
    const msg = describeAutoPublishFailure('YouTube not connected')
    expect(msg).toContain('isn’t connected')
    expect(msg).toContain('Settings')
  })

  it('explains a spent daily quota and promises a retry', () => {
    const msg = describeAutoPublishFailure('daily upload quota reached (6/day)')
    expect(msg).toContain('daily upload limit')
    expect(msg).toContain('retry')
  })

  it('surfaces an unknown upload rejection verbatim so nothing is hidden', () => {
    const msg = describeAutoPublishFailure('The request cannot be completed (403)')
    expect(msg).toContain('YouTube rejected the upload')
    expect(msg).toContain('403')
  })

  it('falls back to a safe generic line for empty or missing reasons', () => {
    const generic = 'Not posted — the upload didn’t go through.'
    expect(describeAutoPublishFailure(null)).toBe(generic)
    expect(describeAutoPublishFailure(undefined)).toBe(generic)
    expect(describeAutoPublishFailure('   ')).toBe(generic)
  })

  it('always begins with the plain-language "Not posted" prefix', () => {
    for (const reason of ['YouTube not connected', 'daily upload quota reached (6/day)', 'boom', '']) {
      expect(describeAutoPublishFailure(reason).startsWith('Not posted')).toBe(true)
    }
  })
})
