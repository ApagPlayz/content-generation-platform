// Unit tests for the metrics auto-refresh helpers (issue #50). Both functions are
// pure, so we assert the throttle boundary and the freshness-label buckets
// directly — no clock, no database. A regression in the hourly throttle would
// otherwise silently either hammer the YouTube quota or stop refreshing, and a
// regression in the label would silently mislead the owner about how fresh the
// numbers are.

import { describe, expect, it } from 'vitest'
import { AUTO_REFRESH_INTERVAL_MS, shouldAutoRefresh, formatRefreshedAgo } from './metrics-refresh'

const HOUR = AUTO_REFRESH_INTERVAL_MS
const NOW = 10_000_000_000 // fixed "now" so every case is deterministic

describe('shouldAutoRefresh', () => {
  it('fires on the very first run (never refreshed)', () => {
    expect(shouldAutoRefresh(NOW, undefined)).toBe(true)
  })

  it('does not fire while inside the interval', () => {
    expect(shouldAutoRefresh(NOW, NOW - (HOUR - 1))).toBe(false)
  })

  it('fires once the full interval has elapsed', () => {
    expect(shouldAutoRefresh(NOW, NOW - (HOUR + 1))).toBe(true)
  })

  it('fires exactly at the boundary (>=)', () => {
    expect(shouldAutoRefresh(NOW, NOW - HOUR)).toBe(true)
  })

  it('honours a custom interval', () => {
    const tenMin = 10 * 60 * 1000
    expect(shouldAutoRefresh(NOW, NOW - (tenMin - 1), tenMin)).toBe(false)
    expect(shouldAutoRefresh(NOW, NOW - tenMin, tenMin)).toBe(true)
  })
})

describe('formatRefreshedAgo', () => {
  it('returns null when never refreshed', () => {
    expect(formatRefreshedAgo(null, NOW)).toBeNull()
    expect(formatRefreshedAgo(undefined, NOW)).toBeNull()
  })

  it('says "just now" under a minute', () => {
    expect(formatRefreshedAgo(new Date(NOW - 30_000), NOW)).toBe('just now')
  })

  it('reports minutes under an hour', () => {
    expect(formatRefreshedAgo(new Date(NOW - 12 * 60_000), NOW)).toBe('12m ago')
    expect(formatRefreshedAgo(new Date(NOW - 59 * 60_000), NOW)).toBe('59m ago')
  })

  it('reports hours under a day', () => {
    expect(formatRefreshedAgo(new Date(NOW - 3 * 60 * 60_000), NOW)).toBe('3h ago')
  })

  it('reports days beyond a day', () => {
    expect(formatRefreshedAgo(new Date(NOW - 2 * 24 * 60 * 60_000), NOW)).toBe('2d ago')
  })
})
