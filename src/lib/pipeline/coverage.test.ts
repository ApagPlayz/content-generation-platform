// Unit tests for the dedup + rotation helper (src/lib/pipeline/coverage.ts).
// This is the fix for the "factories keep re-covering the same subject" bug:
// 27 videos but only 19 distinct scripts (5× Wright Brothers, 5× Panic of 1907
// …). The two failure modes were (1) `getDate() % length` picked the same
// index all day and (2) nothing ever checked what had already been produced.
// These tests lock the contract that fixes both: exclusion beats rotation,
// rotation beats list order, and everything fails OPEN (never dead-ends a run).

import { describe, expect, it, vi } from 'vitest'
import {
  normalizeSubject,
  orderByCoverageAndRotation,
  recentCoverage,
  nextRotationCursor,
  type CoverageEntry,
} from './coverage'

const at = (iso: string) => new Date(iso)
const cov = (name: string, iso: string): CoverageEntry => ({
  normalized: normalizeSubject(name),
  coveredAt: at(iso),
})

describe('normalizeSubject', () => {
  it('lowercases, strips parenthetical years, punctuation and collapses space', () => {
    expect(normalizeSubject('Leopold and Loeb (1924)')).toBe('leopold and loeb')
    expect(normalizeSubject('Leopold & Loeb')).toBe('leopold loeb')
    expect(normalizeSubject('  Panic  of 1907!! ')).toBe('panic of')
    expect(normalizeSubject('Standard Oil')).toBe('standard oil')
  })

  it('matches the title form and the bare form to the same key', () => {
    expect(normalizeSubject('Wright Brothers (1903)')).toBe(normalizeSubject('Wright Brothers'))
  })
})

describe('orderByCoverageAndRotation', () => {
  const list = ['Alpha', 'Bravo', 'Charlie', 'Delta']

  it('with no coverage, rotates the start point by the cursor (nothing excluded)', () => {
    expect(orderByCoverageAndRotation(list, (s) => s, [], 0).ordered).toEqual([
      'Alpha', 'Bravo', 'Charlie', 'Delta',
    ])
    expect(orderByCoverageAndRotation(list, (s) => s, [], 1).ordered).toEqual([
      'Bravo', 'Charlie', 'Delta', 'Alpha',
    ])
    // Cursor is an ever-incrementing counter; callers rely on the % wrap.
    expect(orderByCoverageAndRotation(list, (s) => s, [], 5).ordered).toEqual([
      'Bravo', 'Charlie', 'Delta', 'Alpha',
    ])
  })

  it('pushes covered candidates to the back, keeping uncovered in rotated order', () => {
    const coverage = [cov('Bravo', '2026-07-20')]
    const { ordered, exhausted } = orderByCoverageAndRotation(list, (s) => s, coverage, 0)
    expect(ordered).toEqual(['Alpha', 'Charlie', 'Delta', 'Bravo'])
    expect(exhausted).toBe(false)
  })

  it('orders the covered tail least-recently-covered first', () => {
    const coverage = [
      cov('Alpha', '2026-07-21'), // most recent
      cov('Bravo', '2026-07-10'), // oldest
      cov('Charlie', '2026-07-15'),
      cov('Delta', '2026-07-18'),
    ]
    const { ordered, exhausted } = orderByCoverageAndRotation(list, (s) => s, coverage, 0)
    // All covered → tail is pure LRU: Bravo(10) < Charlie(15) < Delta(18) < Alpha(21).
    expect(ordered).toEqual(['Bravo', 'Charlie', 'Delta', 'Alpha'])
    expect(exhausted).toBe(true)
  })

  it('matches a candidate as a substring of a longer covered subject (F9 case)', () => {
    // Sports ComplianceReport.caseName is a whole trigger sentence.
    const coverage = [cov('Career highlights feature for Michael Jordan (Bulls)', '2026-07-20')]
    const players = ['LeBron James', 'Michael Jordan', 'Kobe Bryant']
    const { ordered } = orderByCoverageAndRotation(players, (s) => s, coverage, 0)
    // Jordan is covered → last; the other two keep rotated order.
    expect(ordered).toEqual(['LeBron James', 'Kobe Bryant', 'Michael Jordan'])
  })

  it('is fail-open: an exhausted watchlist still yields a full ordering', () => {
    const coverage = list.map((n) => cov(n, '2026-07-20'))
    const { ordered, exhausted } = orderByCoverageAndRotation(list, (s) => s, coverage, 2)
    expect(exhausted).toBe(true)
    expect(ordered).toHaveLength(4)
    expect([...ordered].sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })

  it('handles an empty watchlist without throwing', () => {
    expect(orderByCoverageAndRotation([], (s: string) => s, [], 0)).toEqual({
      ordered: [],
      exhausted: false,
    })
  })
})

describe('recentCoverage', () => {
  function fakeDb(
    reports: { caseName: string; createdAt: Date }[],
    videos: { title: string | null; createdAt: Date }[]
  ) {
    return {
      complianceReport: { findMany: vi.fn().mockResolvedValue(reports) },
      video: { findMany: vi.fn().mockResolvedValue(videos) },
      setting: { findUnique: vi.fn(), upsert: vi.fn() },
    }
  }

  it('merges ComplianceReport case names and Video titles, normalized, newest first', async () => {
    const db = fakeDb(
      [{ caseName: 'Leopold and Loeb (1924)', createdAt: at('2026-07-21') }],
      [{ title: 'Wright Brothers (1903)', createdAt: at('2026-07-20') }]
    )
    const out = await recentCoverage({ factoryType: 'F10', db })
    expect(out.map((e) => e.normalized)).toEqual(['leopold and loeb', 'wright brothers'])
  })

  it('scopes ComplianceReport by factoryType and Video by factory.type', async () => {
    const db = fakeDb([], [])
    await recentCoverage({ factoryType: 'F11', db })
    expect(db.complianceReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { factoryType: 'F11' } })
    )
    expect(db.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { factory: { type: 'F11' } } })
    )
  })

  it('narrows to a single factory when factoryId is given', async () => {
    const db = fakeDb([], [])
    await recentCoverage({ factoryType: 'F10', factoryId: 'fac_1', db })
    expect(db.complianceReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { factoryType: 'F10', video: { factoryId: 'fac_1' } } })
    )
    expect(db.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { factoryId: 'fac_1' } })
    )
  })

  it('drops empty/blank names', async () => {
    const db = fakeDb(
      [{ caseName: '   ', createdAt: at('2026-07-21') }],
      [{ title: null, createdAt: at('2026-07-20') }]
    )
    expect(await recentCoverage({ factoryType: 'F10', db })).toEqual([])
  })

  it('keeps the newest `limit` rows OR anything within `days`, whichever is more', async () => {
    const now = Date.now()
    const day = 86_400_000
    const reports = [
      { caseName: 'Recent A', createdAt: new Date(now - 1 * day) },
      { caseName: 'Recent B', createdAt: new Date(now - 2 * day) },
      { caseName: 'Old C', createdAt: new Date(now - 100 * day) }, // outside days window
    ]
    const db = fakeDb(reports, [])
    // limit 1 keeps the single newest; days=30 additionally keeps Recent B (2d)
    // but NOT Old C (100d). Union = {Recent A, Recent B}.
    const out = await recentCoverage({ factoryType: 'F10', db, limit: 1, days: 30 })
    expect(out.map((e) => e.normalized)).toEqual(['recent a', 'recent b'])
  })

  it('fails open to [] when the DB throws', async () => {
    const db = {
      complianceReport: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
      video: { findMany: vi.fn().mockResolvedValue([]) },
      setting: { findUnique: vi.fn(), upsert: vi.fn() },
    }
    expect(await recentCoverage({ factoryType: 'F10', db })).toEqual([])
  })
})

describe('nextRotationCursor', () => {
  function settingDb(initial: string | null) {
    const store = { value: initial }
    return {
      setting: {
        findUnique: vi.fn(async () => (store.value === null ? null : { value: store.value })),
        upsert: vi.fn(async (args: unknown) => {
          store.value = (args as { create: { value: string } }).create.value
          return {}
        }),
      },
      _store: store,
    }
  }

  it('returns 0 on first use and persists the advance to 1', async () => {
    const db = settingDb(null)
    expect(await nextRotationCursor('F10', db)).toBe(0)
    expect(db._store.value).toBe('1')
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'rotation_cursor:F10' } })
    )
  })

  it('returns the stored value and advances it (survives restarts via the DB)', async () => {
    const db = settingDb('7')
    expect(await nextRotationCursor('F10', db)).toBe(7)
    expect(db._store.value).toBe('8')
  })

  it('advances forward on repeated same-day calls', async () => {
    const db = settingDb('0')
    expect(await nextRotationCursor('F10', db)).toBe(0)
    expect(await nextRotationCursor('F10', db)).toBe(1)
    expect(await nextRotationCursor('F10', db)).toBe(2)
  })

  it('treats a malformed stored value as 0', async () => {
    const db = settingDb('not-a-number')
    expect(await nextRotationCursor('F10', db)).toBe(0)
    expect(db._store.value).toBe('1')
  })

  it('fails open to the day-of-month when the DB throws', async () => {
    const db = {
      setting: {
        findUnique: vi.fn().mockRejectedValue(new Error('db down')),
        upsert: vi.fn(),
      },
    }
    expect(await nextRotationCursor('F10', db)).toBe(new Date().getDate())
  })
})
