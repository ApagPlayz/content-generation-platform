// Tests for the F10 offline/fallback script assembly (src/lib/truecrime/script.ts):
//   1. angleCopyFor — the editorial-angle → grammatical-copy map that replaced
//      raw-slug interpolation (the "This courtroom sticks to…" bug).
//   2. The no-consecutive-repeat guarantee in the template beat assembly (the
//      old bug where a fact-poor case repeated one sentence 3× back-to-back).
// generateScript runs the deterministic template path whenever useAiScript is
// off, so no API key or network is needed.

import { describe, expect, it } from 'vitest'
import { angleCopyFor, generateScript } from './script'
import type { CaseBrief, F10FactoryConfig } from './types'

function brief(overrides: Partial<CaseBrief> = {}): CaseBrief {
  return {
    caseName: 'Test Case',
    wikipediaTitle: 'Test Case',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Test_Case',
    summary: 'A short summary of the test case for the offline template.',
    facts: ['Fact one.', 'Fact two.', 'Fact three.'],
    subjects: [{ name: 'A. Person', role: 'convicted', living: false, isMinor: false }],
    angle: 'A tight, scroll-stopping angle line.',
    livingWarnings: [],
    ...overrides,
  }
}

const cfg: F10FactoryConfig = { useAiScript: false, targetDurationSec: 75 }

describe('angleCopyFor', () => {
  it('maps each known angle to a grammatical, full-sentence close (never a raw slug)', () => {
    for (const angle of [
      'investigation',
      'forensics',
      'courtroom',
      'aftermath',
      'forensic-breakdown',
      'legal-procedure-explainer',
      'timeline-reconstruction',
      'unanswered-questions',
      'investigative-recap',
    ]) {
      const { close } = angleCopyFor(angle)
      // Full sentence: starts uppercase, ends with a period.
      expect(close[0]).toBe(close[0].toUpperCase())
      expect(close.endsWith('.')).toBe(true)
      // The old broken shape "This <slug> sticks to…" must never appear.
      expect(close).not.toMatch(/^This \S+ sticks/)
      expect(close).not.toContain(`This ${angle} `)
    }
  })

  it('falls back to a safe generic close for an unknown angle', () => {
    const { close, framing } = angleCopyFor('some-brand-new-angle')
    expect(close).toBe(angleCopyFor('').close)
    expect(framing).toBe('closer look')
    expect(close).not.toContain('some-brand-new-angle')
  })
})

describe('template beat assembly — no consecutive repeats', () => {
  function noConsecutiveDupes(narrations: string[]) {
    for (let i = 1; i < narrations.length; i++) {
      expect(narrations[i], `beat ${i} equals beat ${i - 1}`).not.toBe(narrations[i - 1])
    }
  }

  it('never emits the same sentence in two adjacent beats when facts duplicate', async () => {
    // Adjacent duplicate facts would, without the guard, land in adjacent beats.
    const s = await generateScript(
      'vid-dup',
      'playbook',
      brief({ facts: ['A.', 'DUP.', 'DUP.', 'B.', 'C.'] }),
      cfg
    )
    const narrations = (s.beats ?? []).map((b) => b.narration)
    expect(narrations.length).toBeGreaterThan(3)
    noConsecutiveDupes(narrations)
  })

  it('never repeats a filler line back-to-back for a fact-poor case', async () => {
    // One usable fact + a reserved climax fact forces the filler path for most beats.
    const s = await generateScript('vid-poor', 'playbook', brief({ facts: ['Only fact.'] }), cfg)
    const narrations = (s.beats ?? []).map((b) => b.narration)
    noConsecutiveDupes(narrations)
  })
})

describe('editorial close wording', () => {
  it('injects the mapped grammatical close, not a raw slug, into the resolution beat', async () => {
    const s = await generateScript('vid-close', 'playbook', brief(), cfg)
    const resolution = (s.beats ?? []).find((b) => b.name.toLowerCase().includes('resolution'))
    expect(resolution).toBeTruthy()
    // Whatever angle the rotation picked, the close must be one of the mapped
    // sentences — so it must never read "This <angle> sticks to…".
    expect(resolution!.narration).not.toMatch(/This \S+ sticks to what the public record/)
  })
})
