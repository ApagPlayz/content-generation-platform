// Shared retry policy for pipeline stages. Most stage failures are transient —
// a network blip fetching a clip, a Claude/Wikipedia timeout, ffmpeg losing a
// race on a temp file. Retrying with a short exponential backoff turns those
// from a failed run into a brief pause. Stage callbacks should be written so a
// re-run is safe (idempotent writes / upserts) since the whole callback re-runs.

export const MAX_STAGE_ATTEMPTS = 3

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Backoff before the next attempt. attempt is 1-based: 500ms, 1500ms, 4500ms… */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * Math.pow(3, attempt - 1))
}
