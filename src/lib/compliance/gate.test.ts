// Unit tests for decideGate() (src/lib/compliance/gate.ts) — the pure function
// that combines the five compliance checks into one verdict: block (never
// produce), route_to_review (draft, human must approve), or pass (auto-publish).
// This is the last gate before an autonomous true-crime video goes out, so the
// precedence matters: any hard block must win, and any softer concern must at
// least force a human review rather than slipping through to auto-publish. These
// cases lock that precedence so a future edit can't quietly turn a review into a
// pass. (Issue #45.)

import { describe, expect, it } from 'vitest'
import { decideGate } from './gate'

// A fully-clean input; individual tests override one field to isolate its effect.
function clean() {
  return {
    defamation: [] as { severity: 'block' | 'review' | 'warn' }[],
    visualFlags: [] as { severity: 'block' | 'review' | 'warn' }[],
    failedClaimCount: 0,
    variationPassed: true,
    caseSelectionWarnings: 0,
    targetDurationSec: 90,
    minDurationSec: 60,
  }
}

describe('decideGate', () => {
  it('passes when every check is clean', () => {
    expect(decideGate(clean())).toBe('pass')
  })

  it('blocks on a defamation block flag', () => {
    expect(decideGate({ ...clean(), defamation: [{ severity: 'block' }] })).toBe('block')
  })

  it('blocks on a prohibited-visual block flag', () => {
    expect(decideGate({ ...clean(), visualFlags: [{ severity: 'block' }] })).toBe('block')
  })

  it('a block wins even when review flags are also present', () => {
    expect(
      decideGate({
        ...clean(),
        defamation: [{ severity: 'review' }, { severity: 'block' }],
      })
    ).toBe('block')
  })

  it('routes to review on a defamation review flag', () => {
    expect(decideGate({ ...clean(), defamation: [{ severity: 'review' }] })).toBe('route_to_review')
  })

  it('routes to review on a defamation warn flag', () => {
    expect(decideGate({ ...clean(), defamation: [{ severity: 'warn' }] })).toBe('route_to_review')
  })

  it('routes to review when a load-bearing claim is uncorroborated', () => {
    expect(decideGate({ ...clean(), failedClaimCount: 1 })).toBe('route_to_review')
  })

  it('routes to review when the variation check fails', () => {
    expect(decideGate({ ...clean(), variationPassed: false })).toBe('route_to_review')
  })

  it('routes to review on a case-selection warning', () => {
    expect(decideGate({ ...clean(), caseSelectionWarnings: 1 })).toBe('route_to_review')
  })

  it('routes to review when the video is under the minimum duration', () => {
    expect(decideGate({ ...clean(), targetDurationSec: 30, minDurationSec: 60 })).toBe('route_to_review')
  })
})
