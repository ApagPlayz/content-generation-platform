// Round-7 stall-timeout for the SPORTS pipeline (mirrors the true-crime and
// history orchestrators): a stage whose body never settles must REJECT with its
// budget message and mark the Job 'failed', so a sports run can never sit in
// 'running' forever (issue #96 — the failure the other two pipelines already
// guard against). withTimeout itself is unit-tested in truecrime/budget.test.ts;
// this proves the sports `stage` actually wraps fn() in it and that the rejection
// flows into the existing Job-'failed' path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the vi.mock factory (hoisted above imports) can reference them.
const { jobCreate, jobUpdate } = vi.hoisted(() => ({
  jobCreate: vi.fn(),
  jobUpdate: vi.fn(),
}))

vi.mock('./prisma', () => ({
  prisma: { job: { create: jobCreate, update: jobUpdate } },
}))

import { stage } from './orchestrator'
import type { ToolContext } from './tools/types'

describe('sports stage stall-timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    jobCreate.mockResolvedValue({ id: 'job-1' }) // result is dereferenced (job.id)
    jobUpdate.mockResolvedValue({})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('rejects with the budget message and marks the Job failed when a stage stalls', async () => {
    const ctx = { videoId: 'v1' } as ToolContext
    // A stage body that never settles — the round-6 stuck-run failure mode.
    const promise = stage(ctx, 'source', () => new Promise<void>(() => {}))

    // Attach the rejection expectation BEFORE advancing time so the rejection is
    // always handled (no unhandled-rejection noise under fake timers).
    const assertion = expect(promise).rejects.toThrow(
      'stage "source" exceeded its 15min budget'
    )

    // Fast-forward every timer instantly + deterministically: the 15-min deadline
    // on each of the 3 attempts AND the backoff sleeps between them.
    await vi.runAllTimersAsync()
    await assertion

    // The overrun flowed into the orchestrator's existing failure path.
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    )
  })

  it('gives the assemble stage extra render headroom (30min budget)', async () => {
    const ctx = { videoId: 'v1' } as ToolContext
    const promise = stage(ctx, 'assemble', () => new Promise<void>(() => {}))
    const assertion = expect(promise).rejects.toThrow(
      'stage "assemble" exceeded its 30min budget'
    )
    await vi.runAllTimersAsync()
    await assertion
  })
})
