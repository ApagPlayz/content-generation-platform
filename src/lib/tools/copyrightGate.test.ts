import { describe, expect, it } from 'vitest'
import {
  buildSportsSignature,
  evaluateCopyrightRisk,
  sportsFootageToken,
  type CopyrightRiskInput,
} from './copyrightGate'

// A fully-transformed, license-accounted clip on a claim-tolerant league — the
// only shape that should be allowed to auto-publish.
const CLEAN: CopyrightRiskInput = {
  caseName: 'Lakers vs Celtics',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  sourceLicense: 'licensed',
  licenseRef: 'storyblocks-12345',
  strategy: 'trending_game',
  league: 'nba',
  leagueTolerance: 'favor',
  treatments: ['punch-in', 'slow-mo-peak', 'telestration', 'commentary'],
  analysisLines: 3,
  telestrationCount: 2,
  reframedVertical: true,
  durationSec: 20,
}

describe('evaluateCopyrightRisk', () => {
  it('fails closed on the default unlicensed broadcast download', () => {
    // The real-world default: raw yt-dlp reel, no license logged.
    const v = evaluateCopyrightRisk({
      caseName: 'Some Game',
      strategy: 'trending_game',
      league: 'nba',
      leagueTolerance: 'favor',
      reframedVertical: true,
      durationSec: 20,
      treatments: ['punch-in', 'telestration'],
    })
    expect(v.decision).toBe('route_to_review')
    expect(v.riskLevel).toBe('high')
    expect(v.licenseFlags.length).toBeGreaterThan(0)
    expect(v.riskReasons.join(' ')).toMatch(/no logged license/i)
  })

  it('passes a fully-transformed, licensed clip on a tolerant league', () => {
    const v = evaluateCopyrightRisk(CLEAN)
    expect(v.decision).toBe('pass')
    expect(v.riskLevel).toBe('low')
    expect(v.checklistPassed).toBe(true)
    expect(v.checklistScore).toBe(4)
    expect(v.riskReasons).toHaveLength(0)
  })

  it('routes a raw cropped re-upload to review (checklist fails)', () => {
    // Licensed + tolerant league, but no transformation beyond the 9:16 crop.
    const v = evaluateCopyrightRisk({
      ...CLEAN,
      treatments: [],
      analysisLines: 0,
      telestrationCount: 0,
    })
    expect(v.checklistPassed).toBe(false)
    expect(v.checklistScore).toBeLessThan(3)
    expect(v.decision).toBe('route_to_review')
    expect(v.riskReasons.join(' ')).toMatch(/raw re-upload/i)
  })

  it('passes at exactly 3 of 4 transform signals (checklist boundary)', () => {
    // Reframed + commentary + graphics, but a longer excerpt fails "kept short":
    // 3/4 with the 9:16 reframe present is our "clearly transformed" threshold.
    const v = evaluateCopyrightRisk({ ...CLEAN, durationSec: 45 })
    expect(v.checklist.keptShort).toBe(false)
    expect(v.checklistScore).toBe(3)
    expect(v.checklistPassed).toBe(true)
    expect(v.decision).toBe('pass')
  })

  it('fails the checklist when not reframed, even with 3 other signals', () => {
    // The 9:16 reframe is required — a horizontal re-upload can never "pass"
    // the transformation checklist no matter how many other edits it has.
    const v = evaluateCopyrightRisk({ ...CLEAN, reframedVertical: false })
    expect(v.checklist.reframedVertical).toBe(false)
    expect(v.checklistScore).toBe(3)
    expect(v.checklistPassed).toBe(false)
    expect(v.decision).toBe('route_to_review')
  })

  it('flags a rights-aggressive league even when fully transformed', () => {
    const v = evaluateCopyrightRisk({ ...CLEAN, league: 'nfl', leagueTolerance: 'flag' })
    expect(v.decision).toBe('route_to_review')
    expect(v.riskLevel).toBe('high')
    expect(v.riskReasons.join(' ')).toMatch(/rights-aggressive|strike/i)
  })

  it('flags external trending audio as background-music risk', () => {
    const v = evaluateCopyrightRisk({ ...CLEAN, strategy: 'trending_audio' })
    expect(v.decision).toBe('route_to_review')
    expect(v.riskLevel).toBe('high')
    expect(v.riskReasons.join(' ')).toMatch(/background music|trending audio/i)
  })

  it('blocks a league the operator has policy-blocked', () => {
    const v = evaluateCopyrightRisk({ ...CLEAN, leagueTolerance: 'block' })
    expect(v.decision).toBe('block')
    expect(v.riskLevel).toBe('high')
  })

  it('treats an unidentified league as medium-risk review, not a raw-upload', () => {
    // Licensed + fully transformed, but the league couldn't be sniffed.
    const v = evaluateCopyrightRisk({ ...CLEAN, league: 'unknown', leagueTolerance: 'unknown' })
    expect(v.decision).toBe('route_to_review')
    expect(v.riskLevel).toBe('medium')
    expect(v.riskReasons.join(' ')).toMatch(/couldn't be identified/i)
  })

  it("counts a missing license ref on a licensed asset as unaccounted", () => {
    const v = evaluateCopyrightRisk({ ...CLEAN, licenseRef: undefined })
    expect(v.decision).toBe('route_to_review')
    expect(v.licenseFlags.length).toBeGreaterThan(0)
  })

  it('carries the exact fields the Review inbox reads (report → UI contract)', () => {
    // gateSportsCopyright persists JSON.stringify(verdict); the inbox
    // (src/app/page.tsx sportsCopyrightFromReport) reads these keys by name.
    // Renaming any of them silently drops the copyright chips from the card,
    // so pin the contract here.
    const v = evaluateCopyrightRisk(CLEAN)
    expect(v).toHaveProperty('riskLevel')
    expect(v).toHaveProperty('checklistScore')
    expect(v).toHaveProperty('checklistPassed')
    expect(Array.isArray(v.riskReasons)).toBe(true)
  })
})

// Anti-repetition signature builder (issue #17) — pure, no DB. These lock the two
// gotchas: the source-reel fingerprint must survive YouTube's `?v=` query (which
// the visual-signature URL normaliser strips), and the narration/structure map.
describe('buildSportsSignature / sportsFootageToken', () => {
  it('fingerprints distinct source reels differently (survives the ?v= query strip)', () => {
    // Two different games off different watch URLs must NOT collapse to one hash —
    // if they did, every 2nd sports video would read as a 100% footage dupe.
    const a = buildSportsSignature({ ...CLEAN, caseName: 'Lakers vs Celtics', sourceUrl: 'https://youtube.com/watch?v=aaaaaaa' })
    const b = buildSportsSignature({ ...CLEAN, caseName: 'Heat vs Bucks', sourceUrl: 'https://youtube.com/watch?v=bbbbbbb' })
    expect(a.visualSignature).toHaveLength(1)
    expect(b.visualSignature).toHaveLength(1)
    expect(a.visualSignature).not.toEqual(b.visualSignature)
  })

  it('fingerprints the SAME reel identically (reused broadcast → footage repeat)', () => {
    const a = buildSportsSignature({ ...CLEAN, sourceUrl: 'https://youtube.com/watch?v=samereel' })
    const b = buildSportsSignature({ ...CLEAN, sourceUrl: 'https://youtu.be/samereel' })
    expect(a.visualSignature).toEqual(b.visualSignature)
  })

  it('falls back to the matchup when there is no source URL', () => {
    expect(sportsFootageToken(undefined, 'Lakers vs Celtics')).toBe('sports-src-lakers-vs-celtics')
    // Same matchup → same token even without a URL.
    const a = buildSportsSignature({ ...CLEAN, sourceUrl: undefined, caseName: 'Lakers vs Celtics' })
    const b = buildSportsSignature({ ...CLEAN, sourceUrl: undefined, caseName: 'Lakers vs Celtics' })
    expect(a.visualSignature).toEqual(b.visualSignature)
  })

  it('builds narration from hook + description + commentary, and a template structure', () => {
    const sig = buildSportsSignature({
      ...CLEAN,
      hook: 'You will not believe this buzzer beater',
      description: 'A wild finish',
      analysis: ['He shoots from half court', 'Nothing but net'],
      hookStyle: 'bold-claim',
      strategy: 'player_career',
      telestrationCount: 1,
    })
    expect(sig.narration).toContain('buzzer beater')
    expect(sig.narration).toContain('half court')
    expect(sig.structure.hookPattern).toBe('bold-claim')
    expect(sig.structure.visualStyle).toBe('player_career')
    expect(sig.structure.sections).toEqual(['hook', 'analysis', 'telestration', 'cta'])
  })
})
