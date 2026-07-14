// Unit tests for the crash/restart recovery helpers (src/lib/recovery.ts).
// Issue #16: a dead process leaves AgentRun 'running' / Video 'rendering'
// forever. recoverStuckRuns() heals those, but the interesting logic is the
// timeout math that decides what counts as "orphaned" vs "still legitimately
// running" — so the pure helpers get tested here, no database, mirroring the
// repo's colocated pure-function test style.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUCK_TIMEOUT_MS,
  RECOVERABLE_JOB_STATUSES,
  RECOVERABLE_VIDEO_STATUSES,
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

// The recovery sweep keys off these status lists. Issue #30: the original sweep
// only healed videos at 'rendering' and jobs at 'running', so a crash at any
// earlier stage left the video stuck on 'queued' (its status for most of the
// pipeline) and a job orphaned mid-backoff stuck on 'retrying' — both spinning
// forever. These assertions lock in the widened coverage without a database; if
// someone narrows a list back, they go red. (They assert *which* statuses count
// as orphaned; they do not exercise the Prisma query itself, matching this
// file's no-database convention.)
describe('recoverable status lists', () => {
  it('sweeps videos still in the early "queued" stage, not just "rendering"', () => {
    expect(RECOVERABLE_VIDEO_STATUSES).toContain('queued')
    expect(RECOVERABLE_VIDEO_STATUSES).toContain('rendering')
  })

  it('sweeps jobs stuck mid-backoff on "retrying", not just "running"', () => {
    expect(RECOVERABLE_JOB_STATUSES).toContain('running')
    expect(RECOVERABLE_JOB_STATUSES).toContain('retrying')
  })

  it('never lists a terminal status, so finished work is never re-failed', () => {
    for (const terminal of ['approved', 'review', 'rejected', 'failed', 'published']) {
      expect(RECOVERABLE_VIDEO_STATUSES).not.toContain(terminal)
    }
    for (const terminal of ['completed', 'failed']) {
      expect(RECOVERABLE_JOB_STATUSES).not.toContain(terminal)
    }
  })
})
