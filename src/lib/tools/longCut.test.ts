import { describe, expect, it } from 'vitest'
import {
  LONG_CUT_FLOOR_SEC,
  LONG_CUT_TARGET_SEC,
  TIKTOK_REWARDS_MIN_SEC,
  longCutIngestWindowSec,
  longCutIsUsable,
  planLongCut,
  qualifiesForTikTokRewards,
  tiktokRewardsNote,
} from './longCut'

/**
 * Issue #77 — TikTok's Creator Rewards only pays on videos LONGER THAN a
 * minute, so these tests pin the two things that decide whether a post can ever
 * earn: that a planned cut always clears the floor or is refused outright, and
 * that we never quietly call something a "long cut" when it isn't.
 */

const moment = (startSec: number, endSec: number) => ({ startSec, endSec })

describe('planLongCut', () => {
  it('widens the moment to the target length, centred on it', () => {
    const plan = planLongCut(moment(60, 80), 200)
    expect(plan).not.toBeNull()
    expect(plan!.durationSec).toBe(LONG_CUT_TARGET_SEC)
    expect(plan!.endSec - plan!.startSec).toBe(LONG_CUT_TARGET_SEC)
    // Centred on the moment's midpoint (70s) — within the half-second an odd
    // window length costs when the start is rounded to a whole second.
    expect(Math.abs((plan!.startSec + plan!.endSec) / 2 - 70)).toBeLessThanOrEqual(0.5)
  })

  it('clamps to the start of the reel when the moment is right at the beginning', () => {
    const plan = planLongCut(moment(0, 20), 200)
    expect(plan!.startSec).toBe(0)
    expect(plan!.durationSec).toBe(LONG_CUT_TARGET_SEC)
  })

  it('never runs past the end of the downloaded reel', () => {
    const plan = planLongCut(moment(130, 150), 150)
    expect(plan!.endSec).toBeLessThanOrEqual(150)
    expect(plan!.startSec).toBeGreaterThanOrEqual(0)
    expect(plan!.durationSec).toBe(LONG_CUT_TARGET_SEC)
  })

  it('returns null when the reel is too short to ever reach the payout floor', () => {
    // The honest skip: TikTok gets the normal short cut, nothing is padded.
    expect(planLongCut(moment(10, 30), 45)).toBeNull()
    expect(planLongCut(moment(10, 30), LONG_CUT_FLOOR_SEC - 1)).toBeNull()
  })

  it('uses the whole reel when it sits between the floor and the target', () => {
    const plan = planLongCut(moment(20, 40), 63)
    expect(plan).not.toBeNull()
    expect(plan!.startSec).toBe(0)
    expect(plan!.durationSec).toBe(63)
  })

  it('refuses a target below the floor rather than planning a cut that cannot earn', () => {
    expect(planLongCut(moment(10, 30), 300, 45)).toBeNull()
  })

  it('rejects a non-finite source duration instead of planning from NaN', () => {
    expect(planLongCut(moment(10, 30), Number.NaN)).toBeNull()
    expect(planLongCut(moment(10, 30), Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('every plan it does return clears the floor and fits inside the reel', () => {
    for (let source = 0; source <= 200; source += 7) {
      for (let start = 0; start + 20 <= Math.max(source, 20); start += 11) {
        const plan = planLongCut(moment(start, start + 20), source)
        if (!plan) continue
        expect(plan.durationSec).toBeGreaterThanOrEqual(LONG_CUT_FLOOR_SEC)
        expect(plan.startSec).toBeGreaterThanOrEqual(0)
        expect(plan.endSec).toBeLessThanOrEqual(source)
        expect(plan.endSec - plan.startSec).toBe(plan.durationSec)
      }
    }
  })
})

describe('longCutIsUsable', () => {
  it('accepts a rendered file at or above the floor', () => {
    expect(longCutIsUsable(LONG_CUT_FLOOR_SEC)).toBe(true)
    expect(longCutIsUsable(65.4)).toBe(true)
  })

  it('rejects a file that came out short despite what we asked ffmpeg for', () => {
    expect(longCutIsUsable(LONG_CUT_FLOOR_SEC - 0.5)).toBe(false)
    expect(longCutIsUsable(20)).toBe(false)
    expect(longCutIsUsable(Number.NaN)).toBe(false)
  })
})

describe('longCutIngestWindowSec', () => {
  it('always pulls more source than the cut itself needs', () => {
    expect(longCutIngestWindowSec(undefined)).toBeGreaterThan(LONG_CUT_TARGET_SEC)
  })

  it('never downloads less than the existing 90s default', () => {
    expect(longCutIngestWindowSec(undefined)).toBeGreaterThanOrEqual(90)
    expect(longCutIngestWindowSec(30)).toBeGreaterThanOrEqual(90)
  })

  it('respects a larger configured window', () => {
    expect(longCutIngestWindowSec(400)).toBe(400)
  })
})

describe('qualifiesForTikTokRewards', () => {
  it('needs LONGER than a minute, not exactly a minute', () => {
    expect(qualifiesForTikTokRewards(TIKTOK_REWARDS_MIN_SEC)).toBe(false)
    expect(qualifiesForTikTokRewards(TIKTOK_REWARDS_MIN_SEC + 1)).toBe(true)
  })

  it('treats an unknown length as not qualifying', () => {
    expect(qualifiesForTikTokRewards(null)).toBe(false)
    expect(qualifiesForTikTokRewards(undefined)).toBe(false)
    expect(qualifiesForTikTokRewards(Number.NaN)).toBe(false)
  })
})

describe('tiktokRewardsNote', () => {
  it('warns in plain language when the TikTok post cannot earn', () => {
    const note = tiktokRewardsNote(21)
    expect(note).toContain('21s')
    expect(note).toContain("can't earn")
  })

  it('confirms eligibility once the cut is over a minute', () => {
    const note = tiktokRewardsNote(65)
    expect(note).toContain('65s')
    expect(note).toContain('can earn')
  })

  it('says nothing when the length is unknown, rather than guessing', () => {
    expect(tiktokRewardsNote(null)).toBeNull()
    expect(tiktokRewardsNote(undefined)).toBeNull()
    expect(tiktokRewardsNote(0)).toBeNull()
  })
})
