import { beforeEach, describe, expect, it, vi } from 'vitest'

// gateSportsCopyright now runs the anti-repetition (variation) check alongside the
// copyright gate (issue #17). These tests mock the DB to lock: the corpus grows
// (persisted _scriptSignature), a near-duplicate downgrades an otherwise-clean
// pass to review, the check fails CLOSED, and it NEVER turns a copyright block
// into anything softer.

vi.mock('../prisma', () => ({
  prisma: {
    complianceReport: { findMany: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from '../prisma'
import { buildSportsSignature, gateSportsCopyright, type CopyrightRiskInput } from './copyrightGate'

// A fully-transformed, licensed clip on a tolerant league — copyright would 'pass',
// so the ONLY thing that can route it to review here is the variation axis.
const CLEAN: CopyrightRiskInput = {
  caseName: 'Lakers vs Celtics',
  sourceUrl: 'https://youtube.com/watch?v=cleanreel1',
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
  hook: 'The greatest buzzer beater you have ever seen in a playoff game tonight',
  description: 'A wild ending in Los Angeles',
  analysis: ['He pulls up from the logo', 'The whole bench erupts in celebration'],
  hookStyle: 'bold-claim',
}

const opts = { generatedAt: '2026-07-23T00:00:00.000Z' }

function priorRows(rows: Array<Record<string, unknown>>) {
  return rows.map((sig) => ({ report: JSON.stringify({ _scriptSignature: sig }) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.complianceReport.create).mockResolvedValue({} as never)
})

describe('gateSportsCopyright — anti-repetition (issue #17)', () => {
  it('lets a clean, distinct sports video pass and records variationOk=true', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue([] as never) // empty corpus

    const v = await gateSportsCopyright('vid1', CLEAN, opts)

    expect(v.decision).toBe('pass')
    expect(v.variation?.passed).toBe(true)
    const data = vi.mocked(prisma.complianceReport.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data.variationOk).toBe(true)
    // Corpus grows: the persisted report carries the readable-back signature.
    const persisted = JSON.parse(data.report as string)
    expect(persisted._scriptSignature.narration).toContain('buzzer beater')
    expect(persisted._scriptSignature.visualSignature.length).toBeGreaterThan(0)
  })

  it('downgrades a near-duplicate (same narration) from pass to route_to_review', async () => {
    const sig = buildSportsSignature(CLEAN)
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue(
      priorRows([{ narration: sig.narration }]) as never
    )

    const v = await gateSportsCopyright('vid2', CLEAN, opts)

    expect(v.variation?.passed).toBe(false)
    expect(v.decision).toBe('route_to_review')
    expect(v.riskLevel).toBe('medium')
    const data = vi.mocked(prisma.complianceReport.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data.variationOk).toBe(false)
  })

  it('trips on the SAME source reel reused (visual-footage repeat), distinct narration', async () => {
    const sig = buildSportsSignature(CLEAN)
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue(
      priorRows([
        {
          narration: 'A completely different game with entirely unrelated commentary phrasing here.',
          visualSignature: sig.visualSignature, // same reel fingerprint
        },
      ]) as never
    )

    const v = await gateSportsCopyright('vid3', CLEAN, opts)

    expect(v.variation?.passed).toBe(false)
    expect(v.decision).toBe('route_to_review')
  })

  it('fails CLOSED (routes to review, never block) when the corpus query throws', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockRejectedValue(new Error('no such table'))

    const v = await gateSportsCopyright('vid4', CLEAN, opts)

    expect(v.variation?.passed).toBe(false)
    expect(v.decision).toBe('route_to_review')
    expect(v.decision).not.toBe('block')
  })

  it('keeps a copyright BLOCK a block even when variation also fails', async () => {
    const sig = buildSportsSignature(CLEAN)
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue(
      priorRows([{ narration: sig.narration }]) as never
    )

    // Policy-blocked league → evaluateCopyrightRisk returns 'block'.
    const v = await gateSportsCopyright('vid5', { ...CLEAN, leagueTolerance: 'block' }, opts)

    expect(v.variation?.passed).toBe(false)
    expect(v.decision).toBe('block') // variation never softens a hard block
  })

  it('scopes the corpus to F9 rows only (no cross-factory contamination)', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue([] as never)

    await gateSportsCopyright('vid6', CLEAN, opts)

    const where = vi.mocked(prisma.complianceReport.findMany).mock.calls[0][0].where as Record<string, unknown>
    expect(where.factoryType).toBe('F9')
  })
})
