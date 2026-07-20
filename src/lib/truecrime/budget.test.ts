// Unit tests for the hard time budgets (src/lib/truecrime/budget.ts) — the
// round-7 fix for the run that hung FOREVER: the old fetch helper stopped
// covering the request once headers arrived, so a stalled body read (res.json
// / res.arrayBuffer) had no bound at all. These tests drive fetchWithBudget
// with injected fake fetches (never-resolving, stalled-body, flaky) and prove
// it aborts at the budget, retries exactly once, and resolves null instead of
// throwing or hanging. withTimeout is the stage-level analogue: a promise that
// overruns its ceiling REJECTS so the orchestrator's failure path can mark the
// Job + AgentRun 'failed'.

import { describe, expect, it } from 'vitest'
import { fetchBufferBudget, fetchJsonBudget, fetchWithBudget, withTimeout } from './budget'
import type { FetchImpl } from './budget'

const BUDGET_MS = 40 // small real-timer budget keeps the suite fast

/** A fetch that never settles on its own — only the abort signal ends it.
 *  This is the round-6 hang: a connection that silently died. */
function hangingFetch(calls: { n: number }): FetchImpl {
  return (_url, init) => {
    calls.n++
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }
}

/** Headers arrive fine, then the BODY read stalls forever — the exact
 *  identified hang point (res.json()/arrayBuffer() after the old helper had
 *  already cleared its timer). */
function stalledBodyFetch(calls: { n: number }): FetchImpl {
  return (_url, init) => {
    calls.n++
    return Promise.resolve({
      ok: true,
      headers: new Headers(),
      json: () =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    } as unknown as Response)
  }
}

function okJsonFetch(payload: unknown): FetchImpl {
  return async () =>
    ({ ok: true, headers: new Headers(), json: async () => payload } as unknown as Response)
}

describe('fetchWithBudget / fetchJsonBudget', () => {
  it('aborts a never-responding fetch at the budget and resolves null (never hangs, never throws)', async () => {
    const calls = { n: 0 }
    const started = Date.now()
    const out = await fetchJsonBudget('https://x/', { timeoutMs: BUDGET_MS, fetchImpl: hangingFetch(calls) })
    expect(out).toBeNull()
    // Two attempts (initial + one retry), each bounded by the budget.
    expect(calls.n).toBe(2)
    expect(Date.now() - started).toBeLessThan(BUDGET_MS * 2 + 200)
  })

  it('the budget covers the BODY read too — a stall after headers cannot hang (round-6 regression)', async () => {
    const calls = { n: 0 }
    const started = Date.now()
    const out = await fetchJsonBudget('https://x/', { timeoutMs: BUDGET_MS, fetchImpl: stalledBodyFetch(calls) })
    expect(out).toBeNull()
    expect(calls.n).toBe(2)
    expect(Date.now() - started).toBeLessThan(BUDGET_MS * 2 + 200)
  })

  it('retries once: a first-attempt failure still yields the second attempt result', async () => {
    let attempt = 0
    const flaky: FetchImpl = (_url, init) => {
      attempt++
      if (attempt === 1) {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      return okJsonFetch({ fine: true })(_url, init)
    }
    const out = await fetchJsonBudget('https://x/', { timeoutMs: BUDGET_MS, fetchImpl: flaky })
    expect(out).toEqual({ fine: true })
    expect(attempt).toBe(2)
  })

  it('treats a non-2xx response as a miss (null after retry), not a throw', async () => {
    const calls = { n: 0 }
    const notFound: FetchImpl = async () => {
      calls.n++
      return { ok: false, headers: new Headers() } as unknown as Response
    }
    expect(await fetchJsonBudget('https://x/', { timeoutMs: BUDGET_MS, fetchImpl: notFound })).toBeNull()
    expect(calls.n).toBe(2)
  })

  it('retries: 0 disables the extra attempt', async () => {
    const calls = { n: 0 }
    const out = await fetchWithBudget(
      'https://x/',
      { timeoutMs: BUDGET_MS, retries: 0, fetchImpl: hangingFetch(calls) },
      async () => 'never'
    )
    expect(out).toBeNull()
    expect(calls.n).toBe(1)
  })
})

describe('fetchBufferBudget', () => {
  function bufferFetch(bytes: number, contentLength?: number): FetchImpl {
    return async () =>
      ({
        ok: true,
        headers: new Headers(contentLength != null ? { 'content-length': String(contentLength) } : {}),
        arrayBuffer: async () => new ArrayBuffer(bytes),
      } as unknown as Response)
  }

  it('returns the body as a Buffer when within limits', async () => {
    const buf = await fetchBufferBudget('https://x/', { timeoutMs: BUDGET_MS, maxBytes: 100, fetchImpl: bufferFetch(10) })
    expect(buf).not.toBeNull()
    expect(buf?.byteLength).toBe(10)
  })

  it('rejects oversized bodies via content-length AND actual size (null, not throw)', async () => {
    expect(
      await fetchBufferBudget('https://x/', { timeoutMs: BUDGET_MS, maxBytes: 100, fetchImpl: bufferFetch(10, 5000) })
    ).toBeNull()
    expect(
      await fetchBufferBudget('https://x/', { timeoutMs: BUDGET_MS, maxBytes: 100, fetchImpl: bufferFetch(5000) })
    ).toBeNull()
  })
})

describe('withTimeout', () => {
  it('resolves normally when the promise beats the deadline', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'too slow')).resolves.toBe(42)
  })

  it('REJECTS with the given message when the promise overruns — a stuck stage can be marked failed', async () => {
    const never = new Promise(() => {})
    await expect(withTimeout(never, BUDGET_MS, 'stage "footage" exceeded its budget')).rejects.toThrow(
      'stage "footage" exceeded its budget'
    )
  })

  it('propagates the underlying rejection when it loses to a real error, not the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('real failure')), 1000, 'too slow')).rejects.toThrow(
      'real failure'
    )
  })
})
