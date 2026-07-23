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
  lastCoveredAt,
  selectViableCandidate,
  NoViableCandidateError,
  COVERED_COOLDOWN_DAYS,
  RECENT_BAND_SIZE,
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

describe('lastCoveredAt', () => {
  it('returns the most-recent covered time, matching on substring', () => {
    const coverage = [
      cov('Michael Jordan', '2026-07-10'),
      cov('Career highlights feature for Michael Jordan (Bulls)', '2026-07-20'),
    ]
    expect(lastCoveredAt('Michael Jordan', coverage)).toBe(at('2026-07-20').getTime())
  })

  it('returns null for an uncovered name', () => {
    expect(lastCoveredAt('Tulip Mania', [cov('Wall Street Crash', '2026-07-20')])).toBeNull()
  })
})

describe('selectViableCandidate', () => {
  type Topic = { name: string }
  const t = (name: string): Topic => ({ name })
  const NOW = at('2026-07-22').getTime()
  // Ordered uncovered-first exactly as orderByCoverageAndRotation would produce.
  const ordered = [t('Ponzi'), t('Tulip'), t('Triangle'), t('WrightBros'), t('SouthSea')]
  const imgs: Record<string, number> = {
    Ponzi: 4, // starved (article alone)
    Tulip: 10, // viable, uncovered
    Triangle: 14, // viable, uncovered
    WrightBros: 30, // viable but covered-recent
    SouthSea: 8, // viable but covered-recent
  }
  const imageCountOf = async (c: Topic) => imgs[c.name] ?? 0

  it('picks the FIRST uncovered VIABLE candidate, skipping starved uncovered ones', async () => {
    // Ponzi (uncovered) is starved → skipped; Tulip (uncovered, 10) wins BEFORE
    // any covered topic is even probed. This is the core bug fix.
    const pick = await selectViableCandidate(ordered, {
      nameOf: (c) => c.name,
      coverage: [cov('WrightBros', '2026-07-21'), cov('SouthSea', '2026-07-22')],
      imageCountOf,
      minImages: 5,
      now: NOW,
    })
    expect(pick).toEqual({ chosen: t('Tulip'), images: 10, wasCovered: false })
  })

  it('NEVER picks a candidate covered within the cooldown, even if it is the only viable one', async () => {
    // All uncovered are starved; the only image-rich topics were covered today →
    // inside the 7-day cooldown → must THROW, not silently repeat WrightBros.
    const starvedUncovered = { Ponzi: 2, Tulip: 1, Triangle: 0, WrightBros: 30, SouthSea: 8 }
    await expect(
      selectViableCandidate(ordered, {
        nameOf: (c) => c.name,
        coverage: [cov('WrightBros', '2026-07-21'), cov('SouthSea', '2026-07-22')],
        imageCountOf: async (c) => (starvedUncovered as Record<string, number>)[c.name] ?? 0,
        minImages: 5,
        now: NOW,
      })
    ).rejects.toBeInstanceOf(NoViableCandidateError)
  })

  it('falls back to a covered VIABLE candidate once it is OUTSIDE the cooldown (LRU tail order)', async () => {
    // Uncovered all starved; WrightBros was covered 20 days ago (outside cooldown)
    // and is viable → allowed as the least-recently-covered fallback.
    const starvedUncovered = { Ponzi: 2, Tulip: 1, Triangle: 0, WrightBros: 30, SouthSea: 8 }
    const pick = await selectViableCandidate(ordered, {
      nameOf: (c) => c.name,
      coverage: [cov('WrightBros', '2026-07-02'), cov('SouthSea', '2026-07-22')],
      imageCountOf: async (c) => (starvedUncovered as Record<string, number>)[c.name] ?? 0,
      minImages: 5,
      now: NOW,
    })
    expect(pick).toEqual({ chosen: t('WrightBros'), images: 30, wasCovered: true })
  })

  it('a throwing image probe counts as non-viable (0) and never dead-ends the walk', async () => {
    const pick = await selectViableCandidate(ordered, {
      nameOf: (c) => c.name,
      coverage: [],
      imageCountOf: async (c) => {
        if (c.name === 'Ponzi') throw new Error('wiki down')
        return imgs[c.name] ?? 0
      },
      minImages: 5,
      now: NOW,
    })
    expect(pick.chosen).toEqual(t('Tulip'))
  })

  it('throws NoViableCandidateError when nothing is viable at all', async () => {
    await expect(
      selectViableCandidate(ordered, {
        nameOf: (c) => c.name,
        coverage: [],
        imageCountOf: async () => 0,
        minImages: 5,
        now: NOW,
      })
    ).rejects.toThrow(/exhausted or non-viable/)
  })

  it('ships a 7-day default cooldown', () => {
    expect(COVERED_COOLDOWN_DAYS).toBe(7)
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

// Recency-first ordering (the owner directive "stop picking old topics"): among
// UNCOVERED candidates, order newest event-year first so modern, footage-rich
// stories lead; the cursor rotates only WITHIN the newest band (RECENT_BAND_SIZE)
// so a same-day rerun varies which recent story it opens with WITHOUT ever
// dropping into the ancient tail while recent candidates remain. Covered
// candidates keep their LRU fail-open tail — recency never promotes them.
describe('orderByCoverageAndRotation — recency mode (yearOf)', () => {
  type Topic = { name: string; year?: number }
  const t = (name: string, year?: number): Topic => ({ name, year })
  const nameOf = (c: Topic) => c.name
  const yearOf = (c: Topic) => c.year
  // Deliberately NOT in year order in the source list — recency must sort it.
  const list: Topic[] = [
    t('Titanic', 1912),
    t('Fukushima', 2011),
    t('BerlinWall', 1989),
    t('Katrina', 2005),
    t('Dahmer', 1991),
    t('Concorde', 2000),
    t('DustBowl', 1934),
    t('DeepwaterHorizon', 2010),
    t('Ripper', 1888),
    t('Columbia', 2003),
  ]
  const yearsDesc = [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).map((c) => c.name)

  it('orders uncovered candidates NEWEST event-year first (old topics fall to the back)', () => {
    const { ordered } = orderByCoverageAndRotation(list, nameOf, [], 0, { yearOf })
    expect(ordered.map(nameOf)).toEqual(yearsDesc)
    // The three most-ancient never lead when recent uncovered candidates exist.
    expect(ordered.slice(0, 3).map(nameOf)).toEqual(['Fukushima', 'DeepwaterHorizon', 'Katrina'])
    expect(ordered.slice(-3).map(nameOf)).toEqual(['DustBowl', 'Titanic', 'Ripper'])
  })

  it('rotates the cursor only WITHIN the newest band, never into the ancient tail', () => {
    // band = RECENT_BAND_SIZE (8) of 10 uncovered. cursor 1 starts at the 2nd
    // newest; the two oldest (DustBowl 1934, Titanic 1912, Ripper 1888 — the
    // beyond-band tail) stay pinned at the back in newest-first order.
    const band = yearsDesc.slice(0, RECENT_BAND_SIZE)
    const tail = yearsDesc.slice(RECENT_BAND_SIZE)
    const { ordered } = orderByCoverageAndRotation(list, nameOf, [], 1, { yearOf })
    const expected = [...band.slice(1), ...band.slice(0, 1), ...tail]
    expect(ordered.map(nameOf)).toEqual(expected)
    // Whatever the cursor, the head is always one of the newest band members…
    expect(band).toContain(ordered[0].name)
    // …and the beyond-band tail is never rotated to the front.
    expect(ordered.map(nameOf).slice(-tail.length)).toEqual(tail)
  })

  it('a small custom recentBandSize narrows which candidates the cursor cycles', () => {
    // band = 3 newest (Fukushima, DeepwaterHorizon, Katrina); cursor 2 → 3rd wins.
    const { ordered } = orderByCoverageAndRotation(list, nameOf, [], 2, {
      yearOf,
      recentBandSize: 3,
    })
    expect(ordered[0].name).toBe('Katrina')
    expect(ordered.slice(0, 3).map(nameOf)).toEqual(['Katrina', 'Fukushima', 'DeepwaterHorizon'])
    // Everything from the 4th newest onward stays in strict newest-first order.
    expect(ordered.slice(3).map(nameOf)).toEqual(yearsDesc.slice(3))
  })

  it('keeps COVERED candidates in the LRU tail — recency never promotes them', () => {
    // Fukushima (the newest) was covered → it must NOT lead; it drops behind every
    // uncovered candidate, and the uncovered head is still newest-first.
    const coverage = [cov('Fukushima', '2026-07-20')]
    const { ordered, exhausted } = orderByCoverageAndRotation(list, nameOf, coverage, 0, { yearOf })
    expect(exhausted).toBe(false)
    expect(ordered[0].name).not.toBe('Fukushima')
    expect(ordered[ordered.length - 1].name).toBe('Fukushima') // covered → tail
    // The uncovered head, minus Fukushima, is still ordered newest-first.
    const uncoveredOrder = yearsDesc.filter((n) => n !== 'Fukushima')
    expect(ordered.slice(0, uncoveredOrder.length).map(nameOf)).toEqual(uncoveredOrder)
  })

  it('sorts entries with an undefined year LAST (as oldest), keeping known years newest-first', () => {
    const withMissing: Topic[] = [t('NoYear'), t('Recent', 2020), t('Old', 1950)]
    const { ordered } = orderByCoverageAndRotation(withMissing, nameOf, [], 0, { yearOf })
    expect(ordered.map(nameOf)).toEqual(['Recent', 'Old', 'NoYear'])
  })

  it('is stable for equal years (ties keep original watchlist order)', () => {
    const ties: Topic[] = [t('A', 1989), t('B', 1989), t('C', 1989)]
    // Small band so the cursor can start mid-tie; band=3, cursor 1 → B, C, A.
    const { ordered } = orderByCoverageAndRotation(ties, nameOf, [], 1, { yearOf })
    expect(ordered.map(nameOf)).toEqual(['B', 'C', 'A'])
    // cursor 0 preserves the original order exactly.
    expect(
      orderByCoverageAndRotation(ties, nameOf, [], 0, { yearOf }).ordered.map(nameOf)
    ).toEqual(['A', 'B', 'C'])
  })

  it('the recency ordering feeds selectViableCandidate so the NEWEST viable uncovered case wins', async () => {
    // End-to-end contract: order by recency, then the existing viability walk
    // returns the first viable one — i.e. the newest uncovered viable candidate.
    const { ordered } = orderByCoverageAndRotation(list, nameOf, [], 0, { yearOf })
    const images: Record<string, number> = {
      Fukushima: 15,
      DeepwaterHorizon: 25,
      Katrina: 19,
      Columbia: 14,
      Concorde: 5,
    }
    const pick = await selectViableCandidate(ordered, {
      nameOf,
      coverage: [],
      imageCountOf: async (c) => images[c.name] ?? 0,
      minImages: 5,
      now: at('2026-07-22').getTime(),
    })
    expect(pick.chosen.name).toBe('Fukushima') // newest uncovered viable case
    expect(pick.wasCovered).toBe(false)
  })

  it('exposes an 8-topic default recent band', () => {
    expect(RECENT_BAND_SIZE).toBe(8)
  })
})
