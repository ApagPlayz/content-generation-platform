// Unit tests for computeNextRun() — the pure timing math that decides when every
// agent's next video gets made (src/lib/scheduler.ts). This is one of the app's
// "unwatched paths": if the hour/day/week rollover math is off by an hour or a
// day, schedules quietly fire at the wrong time (or stop firing) and the owner
// just notices "no new videos" days later. These cases lock the documented
// contract — the strictly-after guarantee, the UTC boundaries, and the
// null-field defaults — so a regression goes red instead of silent. (Issue #20.)

import { describe, expect, it } from 'vitest'
import { computeNextRun } from './scheduler'

// computeNextRun only reads cadence/hourUTC/minuteUTC/dayOfWeek; ScheduleTiming
// isn't exported, so build the shape with a tiny local factory (defaults mirror
// a fresh schedule row: nulls, which the function coalesces to hour 12 / Mon).
function timing(o: {
  cadence: string
  hourUTC?: number | null
  minuteUTC?: number
  dayOfWeek?: number | null
}) {
  return {
    cadence: o.cadence,
    hourUTC: o.hourUTC ?? null,
    minuteUTC: o.minuteUTC ?? 0,
    dayOfWeek: o.dayOfWeek ?? null,
  }
}

// next(...) returns the ISO string so exact instant equality is easy to read.
function next(
  o: Parameters<typeof timing>[0],
  from: string
): string {
  return computeNextRun(timing(o), new Date(from)).toISOString()
}

// Anchor: 2026-07-15 is a WEDNESDAY (getUTCDay() === 3).
// 07-17 Fri(5), 07-19 Sun(0), 07-20 Mon(1), 07-21 Tue(2), 07-22 Wed(3).

describe('computeNextRun — hourly', () => {
  it('fires later this hour at minuteUTC (and zeroes seconds/millis)', () => {
    expect(next({ cadence: 'hourly', minuteUTC: 30 }, '2026-07-15T08:15:30.500Z')).toBe(
      '2026-07-15T08:30:00.000Z'
    )
  })

  it('advances to next hour once the minute has passed', () => {
    expect(next({ cadence: 'hourly', minuteUTC: 30 }, '2026-07-15T08:45:00.000Z')).toBe(
      '2026-07-15T09:30:00.000Z'
    )
  })

  it('is strictly after `from`: an exact match advances a full hour', () => {
    expect(next({ cadence: 'hourly', minuteUTC: 30 }, '2026-07-15T08:30:00.000Z')).toBe(
      '2026-07-15T09:30:00.000Z'
    )
  })

  it('rolls the date when the next hour crosses midnight UTC', () => {
    expect(next({ cadence: 'hourly', minuteUTC: 10 }, '2026-07-15T23:50:00.000Z')).toBe(
      '2026-07-16T00:10:00.000Z'
    )
  })
})

describe('computeNextRun — daily', () => {
  it('fires later today when the target time is still ahead', () => {
    expect(next({ cadence: 'daily', hourUTC: 12 }, '2026-07-15T08:00:00.000Z')).toBe(
      '2026-07-15T12:00:00.000Z'
    )
  })

  it('rolls to tomorrow once the target time has passed', () => {
    expect(next({ cadence: 'daily', hourUTC: 12 }, '2026-07-15T15:00:00.000Z')).toBe(
      '2026-07-16T12:00:00.000Z'
    )
  })

  it('is strictly after `from`: exactly at the target rolls to tomorrow', () => {
    expect(next({ cadence: 'daily', hourUTC: 12 }, '2026-07-15T12:00:00.000Z')).toBe(
      '2026-07-16T12:00:00.000Z'
    )
  })

  it('honours a custom hour + minute', () => {
    expect(next({ cadence: 'daily', hourUTC: 9, minuteUTC: 30 }, '2026-07-15T09:15:00.000Z')).toBe(
      '2026-07-15T09:30:00.000Z'
    )
  })

  it('defaults a null hour to 12:00 UTC', () => {
    expect(next({ cadence: 'daily', hourUTC: null }, '2026-07-15T05:00:00.000Z')).toBe(
      '2026-07-15T12:00:00.000Z'
    )
  })

  it('rolls across a month boundary', () => {
    expect(next({ cadence: 'daily', hourUTC: 12 }, '2026-07-31T20:00:00.000Z')).toBe(
      '2026-08-01T12:00:00.000Z'
    )
  })
})

describe('computeNextRun — weekly', () => {
  it('finds the target weekday later this week', () => {
    // Wed 07-15 → next Friday (dow 5)
    expect(next({ cadence: 'weekly', dayOfWeek: 5, hourUTC: 12 }, '2026-07-15T08:00:00.000Z')).toBe(
      '2026-07-17T12:00:00.000Z'
    )
  })

  it('fires today when the target weekday is today and the time is still ahead', () => {
    expect(next({ cadence: 'weekly', dayOfWeek: 3, hourUTC: 12 }, '2026-07-15T08:00:00.000Z')).toBe(
      '2026-07-15T12:00:00.000Z'
    )
  })

  it('waits a full week when the target weekday is today but the time has passed', () => {
    expect(next({ cadence: 'weekly', dayOfWeek: 3, hourUTC: 12 }, '2026-07-15T14:00:00.000Z')).toBe(
      '2026-07-22T12:00:00.000Z'
    )
  })

  it('wraps to next week when the target weekday is earlier than today', () => {
    // Fri 07-17 → next Monday (dow 1)
    expect(next({ cadence: 'weekly', dayOfWeek: 1, hourUTC: 9 }, '2026-07-17T15:00:00.000Z')).toBe(
      '2026-07-20T09:00:00.000Z'
    )
  })

  it('defaults null dayOfWeek to Monday and null hour to 12:00', () => {
    expect(
      next({ cadence: 'weekly', dayOfWeek: null, hourUTC: null }, '2026-07-15T08:00:00.000Z')
    ).toBe('2026-07-20T12:00:00.000Z')
  })

  it('treats Sunday (dayOfWeek 0) as a real target, not the Monday default', () => {
    // Guards nullish (?? 1) vs falsy (|| 1): 0 must stay 0 → next Sunday 07-19.
    expect(next({ cadence: 'weekly', dayOfWeek: 0, hourUTC: 12 }, '2026-07-15T08:00:00.000Z')).toBe(
      '2026-07-19T12:00:00.000Z'
    )
  })
})

describe('computeNextRun — unknown cadence', () => {
  it('falls through to the daily branch for an unrecognised cadence', () => {
    // Documents the `as Cadence` fallthrough: anything not hourly/weekly = daily.
    const from = '2026-07-15T08:00:00.000Z'
    expect(next({ cadence: 'monthly', hourUTC: 12 }, from)).toBe(
      next({ cadence: 'daily', hourUTC: 12 }, from)
    )
  })
})
