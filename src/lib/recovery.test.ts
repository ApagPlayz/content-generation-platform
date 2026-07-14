// Unit tests for the crash/restart recovery helpers (src/lib/recovery.ts).
// Issue #16: a dead process leaves AgentRun 'running' / Video 'rendering'
// forever. recoverStuckRuns() heals those, but the interesting logic is the
// timeout math that decides what counts as "orphaned" vs "still legitimately
// running" — so the pure helpers get tested here, no database, mirroring the
// repo's colocated pure-function test style.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUCK_TIMEOUT_MS,
  resolveTimeoutMs,
  stuckCutoff,
} from './recovery'

describe('resolveTimeoutMs', () => {
  it('falls back to the default when unset, empty, or non-numeric', () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_STUCK_TIMEOUT_MS)
    expect(resolveTimeoutMs('')).toBe(DEFAULT_STUCK_TIMEOUT_MS)
    expect(resolveTimeoutMs('abc')).toBe(DEFAULT_STUCK_TIMEOUT_MS)
  })

  it('falls back to the default for zero or negative minutes', () => {
    expect(resolveTimeoutMs('0')).toBe(DEFAULT_STUCK_TIMEOUT_MS)
    expect(resolveTimeoutMs('-5')).toBe(DEFAULT_STUCK_TIMEOUT_MS)
  })

  it('converts a positive minutes override to milliseconds', () => {
    expect(resolveTimeoutMs('1')).toBe(60_000)
    expect(resolveTimeoutMs('45')).toBe(45 * 60_000)
    expect(resolveTimeoutMs('90')).toBe(90 * 60_000)
  })
})

describe('stuckCutoff', () => {
  const now = new Date('2026-07-14T12:00:00.000Z')

  it('subtracts the timeout from now', () => {
    expect(stuckCutoff(now, 30 * 60_000).toISOString()).toBe(
      '2026-07-14T11:30:00.000Z'
    )
  })

  it('marks a run started before the cutoff as stuck, but not one after it', () => {
    const cutoff = stuckCutoff(now, DEFAULT_STUCK_TIMEOUT_MS)
    const orphaned = new Date(now.getTime() - DEFAULT_STUCK_TIMEOUT_MS - 1_000)
    const stillLive = new Date(now.getTime() - 60_000) // one minute old
    expect(orphaned < cutoff).toBe(true)
    expect(stillLive < cutoff).toBe(false)
  })

  it('does not treat a run exactly at the timeout as stuck (strict boundary)', () => {
    const cutoff = stuckCutoff(now, DEFAULT_STUCK_TIMEOUT_MS)
    const exactlyAtTimeout = new Date(now.getTime() - DEFAULT_STUCK_TIMEOUT_MS)
    expect(exactlyAtTimeout < cutoff).toBe(false)
  })
})
