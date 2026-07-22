// Tests for the F11 offline/fallback script assembly (src/lib/history/script.ts):
//   1. angleCopyFor — the editorial-angle → grammatical-copy map that replaced
//      raw-slug interpolation (the "This courtroom sticks to…" bug), now with
//      genuinely historical angles (turning-point, human-story, …).
//   2. The no-consecutive-repeat guarantee in the template beat assembly.
// generateHistoryScript runs the deterministic template path whenever
// useAiScript is off, so no API key or network is needed.

import { describe, expect, it } from 'vitest'
import { angleCopyFor, generateHistoryScript } from './script'
import type { F11FactoryConfig, TopicBrief } from './types'

function brief(overrides: Partial<TopicBrief> = {}): TopicBrief {
  return {
    caseName: 'The Wright Brothers',
    wikipediaTitle: 'Wright Flyer',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Wright_Flyer',
    summary: 'Two bicycle mechanics achieved the first powered flight.',
    facts: ['Fact one.', 'Fact two.', 'Fact three.'],
    subjects: [{ name: 'Orville Wright', role: 'investigator', living: false, isMinor: false }],
    angle: 'Two bicycle mechanics beat a government program to the sky.',
    livingWarnings: [],
    ...overrides,
  }
}

const cfg: F11FactoryConfig = { useAiScript: false, targetDurationSec: 75 }

describe('angleCopyFor (history)', () => {
  it('maps the historical angles to grammatical, full-sentence closes', () => {
    for (const angle of [
      'turning-point',
      'human-story',
      'myth-vs-record',
      'legacy',
      'business-postmortem',
      'timeline-reconstruction',
      'decision-point-analysis',
      'rise-and-fall-recap',
    ]) {
      const { close } = angleCopyFor(angle)
      expect(close[0]).toBe(close[0].toUpperCase())
      expect(close.endsWith('.')).toBe(true)
      expect(close).not.toMatch(/^This \S+ sticks/)
      expect(close).not.toContain(`This ${angle} `)
    }
  })

  it('does NOT carry the true-crime "courtroom" framing as a natural default', () => {
    // 'courtroom' isn't a history angle; it falls back to the generic close and
    // must never be interpolated raw ("This courtroom sticks…").
    const { close } = angleCopyFor('courtroom')
    expect(close).toBe(angleCopyFor('').close)
    expect(close).not.toContain('courtroom')
  })
})

describe('template beat assembly — no consecutive repeats (history)', () => {
  function noConsecutiveDupes(narrations: string[]) {
    for (let i = 1; i < narrations.length; i++) {
      expect(narrations[i], `beat ${i} equals beat ${i - 1}`).not.toBe(narrations[i - 1])
    }
  }

  it('never emits the same sentence in two adjacent beats when facts duplicate', async () => {
    const s = await generateHistoryScript(
      'vid-dup',
      'playbook',
      brief({ facts: ['A.', 'DUP.', 'DUP.', 'B.', 'C.'] }),
      cfg
    )
    const narrations = (s.beats ?? []).map((b) => b.narration)
    expect(narrations.length).toBeGreaterThan(3)
    noConsecutiveDupes(narrations)
  })

  it('never repeats a filler line back-to-back for a fact-poor topic', async () => {
    const s = await generateHistoryScript('vid-poor', 'playbook', brief({ facts: ['Only fact.'] }), cfg)
    const narrations = (s.beats ?? []).map((b) => b.narration)
    noConsecutiveDupes(narrations)
  })
})
