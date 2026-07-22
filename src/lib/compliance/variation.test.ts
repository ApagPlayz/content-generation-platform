import { beforeEach, describe, expect, it, vi } from 'vitest'

// The anti-repetition / inauthentic-content check must FAIL CLOSED. If the
// ComplianceReport corpus can't be loaded (DB error, missing/unmigrated table),
// the video must route to human review — never silently pass. These tests lock
// that, plus the legitimate empty-corpus pass (genuinely no prior videos).

vi.mock('../prisma', () => ({
  prisma: {
    complianceReport: { findMany: vi.fn() },
  },
}))

import { prisma } from '../prisma'
import { checkVariation } from './variation'
import type { TrueCrimeScript } from './types'

const script = {
  caseName: 'Case X',
  narration: 'A completely original narration about a unique case with fresh analysis.',
  subjects: [],
  visuals: [],
} as unknown as TrueCrimeScript

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkVariation fail-closed behaviour', () => {
  it('routes to review (passed:false) when the corpus query throws (DB error / missing table)', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockRejectedValue(new Error('no such table'))

    const verdict = await checkVariation(script)

    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/corpus unavailable/i)
  })

  it('passes when there genuinely are no prior videos to compare against', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue([] as never)

    const verdict = await checkVariation(script)

    expect(verdict.passed).toBe(true)
  })

  it('passes a clearly-distinct script against a real prior corpus', async () => {
    vi.mocked(prisma.complianceReport.findMany).mockResolvedValue([
      {
        report: JSON.stringify({
          _scriptSignature: {
            narration: 'An entirely different topic with no shared phrasing whatsoever here.',
          },
        }),
      },
    ] as never)

    const verdict = await checkVariation(script)

    expect(verdict.passed).toBe(true)
  })
})
