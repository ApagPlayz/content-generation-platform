import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The gate is the sole decision point for autonomous true-crime output and had
// no tests. These run it fully offline and lock the three decisions — pass,
// route_to_review, block — plus the two issue #45 holes: a subject named only
// by surname, and a person named in the narration who was never declared.

// ── DB: the variation corpus (findMany) + report persistence (create) ──
vi.mock('../prisma', () => ({
  prisma: { complianceReport: { findMany: vi.fn(), create: vi.fn() } },
}))

// ── Network: ./sources is the only module under compliance/ that fetches.
//    tokenize/matchConfidence must stay REAL — variation.ts imports tokenize
//    from here and silently breaks if the mock replaces the whole module.
vi.mock('./sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sources')>()
  return {
    ...actual,
    wikipediaCorroborate: vi.fn(async () => []),
    gdeltCorroborate: vi.fn(async () => []),
    courtListenerSearch: vi.fn(async () => []),
  }
})

import { prisma } from '../prisma'
import { courtListenerSearch } from './sources'
import { runComplianceGate, gateVideoScript } from './gate'
import { HISTORY_PROFILE } from './profile'
import type { TrueCrimeScript } from './types'

const NOW = '2026-07-27T00:00:00.000Z'

/**
 * A script that genuinely reaches `pass`, so every other fixture can flip one
 * thing and prove that one thing caused the change. Every field here matters:
 *  - a convicted, deceased subject → guiltAssertable, no case-selection warning
 *  - `claims: []` → skips claim extraction AND all corroboration network calls
 *    (an empty array is not nullish, so gate.ts:64 does not call extractClaims)
 *  - targetDurationSec >= 60 → clears the monetization floor
 */
const cleanScript = (over: Partial<TrueCrimeScript> = {}): TrueCrimeScript => ({
  caseName: 'The Lindbergh Kidnapping',
  narration:
    'In 1932 a national manhunt followed the disappearance. The trial reshaped federal law.',
  subjects: [{ name: 'Bruno Hauptmann', role: 'convicted', living: false, isMinor: false }],
  claims: [],
  visuals: [],
  targetDurationSec: 90,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // claims.ts calls api.anthropic.com when this key is set; '' is falsy, so it
  // falls back to the pure, deterministic heuristic extractor.
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  // If anything we missed reaches the network, fail loudly rather than hang.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network disabled in tests')
  }))
  // MUST be set: an unmocked findMany returns undefined, checkVariation fails
  // CLOSED, and every `pass` assertion below would silently become review.
  vi.mocked(prisma.complianceReport.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.complianceReport.create).mockResolvedValue({ id: 'rep_1' } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('runComplianceGate — decision paths', () => {
  it('passes a clean, fully-declared, convicted-subject script', async () => {
    const report = await runComplianceGate(cleanScript(), { generatedAt: NOW })
    expect(report.decision).toBe('pass')
    expect(report.defamation).toEqual([])
  })

  it('blocks at case selection and skips every network and DB check', async () => {
    const report = await runComplianceGate(
      cleanScript({
        subjects: [{ name: 'Jamie Doe', role: 'victim', living: false, isMinor: true }],
      }),
      { generatedAt: NOW }
    )
    expect(report.decision).toBe('block')
    expect(courtListenerSearch).not.toHaveBeenCalled()
    expect(prisma.complianceReport.findMany).not.toHaveBeenCalled()
  })

  it('blocks on an unhedged guilt assertion about a living, non-convicted person', async () => {
    const report = await runComplianceGate(
      cleanScript({
        narration: 'Robert Harlan murdered the victim in cold blood.',
        subjects: [{ name: 'Robert Harlan', role: 'acquitted', living: true, isMinor: false }],
      }),
      { generatedAt: NOW }
    )
    expect(report.decision).toBe('block')
  })

  it('routes to review below the 60s monetization floor', async () => {
    const report = await runComplianceGate(cleanScript({ targetDurationSec: 30 }), {
      generatedAt: NOW,
    })
    expect(report.decision).toBe('route_to_review')
  })

  it('routes to review when the variation corpus is unavailable (fail-closed)', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockRejectedValue(new Error('no such table'))
    const report = await runComplianceGate(cleanScript(), { generatedAt: NOW })
    expect(report.decision).toBe('route_to_review')
  })

  it('routes to review when load-bearing claims cannot be corroborated', async () => {
    const report = await runComplianceGate(
      cleanScript({
        claims: undefined,
        narration: 'In 1932 Bruno Hauptmann was convicted and sentenced to death.',
      }),
      { generatedAt: NOW }
    )
    expect(report.decision).toBe('route_to_review')
  })
})

describe('runComplianceGate — issue #45', () => {
  it('BLOCKS a surname-only guilt assertion that used to slip through as a pass', async () => {
    const report = await runComplianceGate(
      cleanScript({
        caseName: 'State v. Smith',
        narration: 'Smith killed her in the kitchen.',
        // 'acquitted' rather than 'accused': a living accused person is already
        // a hard block at case selection, which would short-circuit the lint.
        subjects: [{ name: 'John Smith', role: 'acquitted', living: true, isMinor: false }],
      }),
      { generatedAt: NOW }
    )
    expect(report.decision).toBe('block')
    expect(report.defamation[0].subjectName).toBe('John Smith')
  })

  it('routes to review when the narration names someone absent from the subject list', async () => {
    const report = await runComplianceGate(
      cleanScript({
        caseName: 'The Garage Murder',
        narration: 'Marcus Webb strangled her in the garage.',
        subjects: [{ name: 'Anna Reed', role: 'victim', living: false, isMinor: false }],
      }),
      { generatedAt: NOW }
    )
    expect(report.decision).toBe('route_to_review')
    expect(report.defamation.map((f) => f.subjectName)).toContain('Marcus Webb')
  })

  it('does not flag the victim when she shares a surname with the accused', async () => {
    const report = await runComplianceGate(
      cleanScript({
        caseName: 'State v. Smith',
        narration: 'Smith killed her in the kitchen.',
        subjects: [
          { name: 'John Smith', role: 'acquitted', living: true, isMinor: false },
          { name: 'Mary Smith', role: 'victim', living: false, isMinor: false },
        ],
      }),
      { generatedAt: NOW }
    )
    expect(report.defamation.map((f) => f.subjectName)).toEqual(['John Smith'])
  })

  it('does not treat a passive victim sentence as an accusation', async () => {
    // Widening to surnames must not start accusing the victim every time the
    // narration says she was murdered — partial matching is limited to roles
    // that can plausibly be accused, and the actor rule ignores passive voice.
    const report = await runComplianceGate(
      cleanScript({
        caseName: 'The Fields Case',
        narration: 'Fields was murdered in her home in 1998. The body had been moved before dawn.',
        subjects: [{ name: 'Sarah Fields', role: 'victim', living: false, isMinor: false }],
      }),
      { generatedAt: NOW }
    )
    expect(report.defamation).toEqual([])
    expect(report.decision).toBe('pass')
  })

  it('leaves the pre-existing full-name victim flag at review, never escalating it', async () => {
    // Naming the victim in full alongside a guilt verb already produced a
    // deceased/non-adjudicated review flag before this change. Locking it here
    // so the wider matching can never turn that into a hard block.
    const report = await runComplianceGate(
      cleanScript({
        caseName: 'The Fields Case',
        narration: 'Sarah Fields was murdered in her home in 1998.',
        subjects: [{ name: 'Sarah Fields', role: 'victim', living: false, isMinor: false }],
      }),
      { generatedAt: NOW }
    )
    expect(report.defamation.map((f) => f.severity)).toEqual(['review'])
    expect(report.decision).toBe('route_to_review')
  })
})

describe('gateVideoScript persistence', () => {
  it('persists the decision, flag count and factory type, and returns the row id', async () => {
    const { report, reportId } = await gateVideoScript(cleanScript(), {
      generatedAt: NOW,
      profile: HISTORY_PROFILE,
    })

    expect(reportId).toBe('rep_1')
    const { data } = vi.mocked(prisma.complianceReport.create).mock.calls[0][0]
    expect(data.factoryType).toBe('F11')
    expect(data.decision).toBe(report.decision)
    expect(data.defamationFlags).toBe(report.defamation.length)
    // The signature is what the variation corpus reads back on the next run.
    expect(JSON.parse(data.report as string)._scriptSignature.narration).toBe(
      cleanScript().narration
    )
  })
})
