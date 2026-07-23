// Pure helpers for the automatic YouTube-metrics refresh (issue #50). Kept free
// of prisma / googleapis / Date.now so they unit-test as plain functions — the
// 60s tick in instrumentation-node.ts and the Winners view pass in `now` and the
// relevant timestamps.

/**
 * How often the background tick may auto-refresh metrics (~1 hour). One YouTube
 * Analytics poll per hour keeps well under the Data API quota while still keeping
 * the Winners leaderboard fresh without a human clicking "Refresh metrics".
 */
export const AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000

/**
 * True when at least `intervalMs` has elapsed since the last auto-refresh — or it
 * has never run (`lastAt` undefined). Pure so the throttle decision is unit-tested
 * without a clock or a database.
 */
export function shouldAutoRefresh(
  now: number,
  lastAt: number | undefined,
  intervalMs: number = AUTO_REFRESH_INTERVAL_MS
): boolean {
  return now - (lastAt ?? 0) >= intervalMs
}

/**
 * Short "just now" / "12m ago" / "3h ago" / "2d ago" label for a last-refreshed
 * time, or null when we've never refreshed (nothing to show). Mirrors the
 * inbox-card `timeAgo` buckets so freshness reads the same across the app.
 */
export function formatRefreshedAgo(from: Date | null | undefined, now: number): string | null {
  if (!from) return null
  const diffMs = now - from.getTime()
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
