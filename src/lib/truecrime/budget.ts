// Hard time budgets for everything that can stall the pipeline (round 7).
//
// The round-6 live run hung FOREVER inside the footage stage: the old
// fetch-with-timeout helper armed its AbortController only until the response
// HEADERS arrived, then cleared the timer — so `res.json()` / `res.arrayBuffer()`
// body reads had no bound at all, and one lost connection froze the whole
// AgentRun at 0% CPU. These helpers put ONE budget over the ENTIRE request —
// connect, headers, and body consumption — retry once on failure, and resolve
// null instead of throwing, so a dead network degrades a tier to a miss
// instead of a hang. `withTimeout` is the same idea for whole pipeline stages:
// a stage that overruns its budget REJECTS, which trips the orchestrator's
// existing failure path (Job 'failed' → AgentRun 'failed') — a run can never
// sit in 'running' forever again.

/** Minimal fetch shape so tests can inject a fake without mocking globals. */
export type FetchImpl = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal; cache?: 'no-store' }
) => Promise<Response>

export interface BudgetOptions {
  /** Whole-request budget (connect + headers + body), milliseconds. */
  timeoutMs: number
  headers?: Record<string, string>
  /** Extra attempts after the first failure. Default 1 (i.e. try twice). */
  retries?: number
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: FetchImpl
}

/**
 * Fetch + consume under ONE abort budget. The AbortSignal stays armed through
 * `consume`, so a body read that stalls after headers arrived is aborted too
 * (the exact round-6 hang). Any failure (timeout, network, non-2xx, consume
 * error) counts as a miss for that attempt; after `retries` extra attempts
 * the result is null — never a throw, never a hang.
 */
export async function fetchWithBudget<T>(
  url: string,
  opts: BudgetOptions,
  consume: (res: Response) => Promise<T>
): Promise<T | null> {
  const attempts = 1 + Math.max(0, opts.retries ?? 1)
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchImpl)
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
    try {
      const res = await fetchImpl(url, {
        headers: opts.headers,
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!res.ok) continue // non-2xx: retry once, then miss
      return await consume(res) // still under the same abort budget
    } catch {
      // timeout / network error / consume failure — retry, then miss
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** JSON GET under a whole-request budget; null on any failure. */
export function fetchJsonBudget(url: string, opts: BudgetOptions): Promise<unknown | null> {
  return fetchWithBudget(url, opts, (res) => res.json())
}

/** Binary GET under a whole-request budget; null on any failure or when the
 *  body exceeds `maxBytes` (checked via content-length AND actual size). */
export function fetchBufferBudget(
  url: string,
  opts: BudgetOptions & { maxBytes?: number }
): Promise<Buffer | null> {
  return fetchWithBudget(url, opts, async (res) => {
    const max = opts.maxBytes ?? Infinity
    const len = Number(res.headers.get('content-length') ?? '0')
    if (len && len > max) throw new Error('too large')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > max) throw new Error('too large')
    return buf
  })
}

/**
 * Race a promise against a hard deadline. On overrun it REJECTS with
 * `message` — callers like the orchestrator stage wrapper let that rejection
 * flow into their existing failure handling, so a stuck stage marks the Job
 * and AgentRun 'failed' instead of leaving the run 'running' forever. The
 * losing promise is not cancelled (JS can't), but every network call under it
 * now carries its own budget, so it settles eventually and is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>
}
