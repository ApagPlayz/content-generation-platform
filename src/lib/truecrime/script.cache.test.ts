// Proves the Anthropic prompt-cache is actually EFFECTIVE for the true-crime
// script stage (issue #90). The `cache_control` breakpoint only saves money if
// the cached prefix is byte-identical across videos. The per-video editorial
// framing (which rotates every run by design, via pickDivergentStyle) must live
// OUTSIDE the cached block, or it busts the prefix on every single video and the
// cache is written but never read. This test locks that contract in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateScript } from './script'
import type { CaseBrief, F10FactoryConfig } from './types'

// prisma is the only module needing a mock: costLedger.create is a no-op and
// complianceReport.findMany returns [] so the recent-style corpus is empty and
// the style pick is driven purely by config. resolveModel/claudeCallCost
// (settings), styleVariation and scoreHookCandidate are pure given that.
vi.mock('../prisma', () => ({
  prisma: {
    costLedger: { create: vi.fn(async () => ({})) },
    complianceReport: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}))

const PLAYBOOK = 'PLAYBOOK: house tone is calm, documentary, faceless.'

const BRIEF: CaseBrief = {
  caseName: 'The Harbor Light Case',
  wikipediaTitle: 'The_Harbor_Light_Case',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/The_Harbor_Light_Case',
  summary: 'A short factual summary of the documented record for this case.',
  facts: [
    'A ship was reported missing in 1921.',
    'Investigators recovered a logbook two years later.',
    'The final entry was never explained.',
    'The insurer disputed the timeline.',
  ],
  subjects: [{ name: 'A. Keeper', role: 'witness', living: false, isMinor: false }],
  year: 1921,
  livingWarnings: [],
}

// Minimal JSON buildFromModel accepts: a non-empty hook.verbal + enough beats
// with non-empty narration (BEATS_60 => 7 specs, need >= ceil(7/2)=4 non-empty).
const MODEL_JSON = {
  hook: {
    type: 'open_loop',
    verbal: 'A logbook surfaced two years late and its final entry was never explained',
    onscreenText: 'The entry no one could explain',
    visualCue: 'slow push-in on an old case file, dim light',
    opensLoop: 'why the final entry was never explained',
    payoffRef: 'Climax',
  },
  beats: [
    { name: 'Hook', narration: 'placeholder — overwritten by hook.verbal', complianceFlag: 'factual' },
    { name: 'Setup', narration: 'A ship was reported missing in 1921.', linkWord: 'therefore', complianceFlag: 'factual' },
    { name: 'Inciting detail', narration: 'Investigators recovered a logbook two years later.', linkWord: 'but', complianceFlag: 'factual' },
    { name: 'Rising complication', narration: 'The insurer disputed the timeline.', linkWord: 'therefore', complianceFlag: 'factual' },
    { name: 'Turn / re-hook', narration: 'A second account contradicted the first.', linkWord: 'but', complianceFlag: 'attributed' },
    { name: 'Climax', narration: 'The final entry was never explained.', linkWord: 'therefore', sourceAttribution: 'court records', complianceFlag: 'attributed' },
    { name: 'Resolution', narration: 'The case remains documented in the public record.', linkWord: 'therefore', complianceFlag: 'factual' },
  ],
  title: 'The Harbor Light Case',
  description: 'A documentary short on a documented maritime mystery.',
  hashtags: ['truecrime', 'coldcase', 'mystery', 'history', 'unsolved'],
}

interface CapturedBody {
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>
}
const capturedBodies: CapturedBody[] = []

beforeEach(() => {
  capturedBodies.length = 0
  process.env.ANTHROPIC_API_KEY = 'test-key-123'
  global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    capturedBodies.push(JSON.parse(init.body))
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(MODEL_JSON) }],
        usage: {
          input_tokens: 1200,
          output_tokens: 500,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 0,
        },
      }),
    } as unknown as Response
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ANTHROPIC_API_KEY
})

function baseConfig(editorialAngles: string[]): F10FactoryConfig {
  return {
    useAiScript: true,
    scriptModel: 'sonnet5', // short-circuits resolveModel; no getSetting DB read
    targetDurationSec: 75, // => BEATS_60 (7 beats)
    editorialAngles, // single element => forced, distinct editorial framing
    enableEditorialLayer: true,
  }
}

describe('generateScript — Anthropic prompt-cache prefix is stable', () => {
  it('keeps the first system block byte-identical while the per-video editorial framing differs', async () => {
    // Same factory/duration/playbook/brief; ONLY the editorial angle differs.
    await generateScript('vid-1', PLAYBOOK, BRIEF, baseConfig(['forensic-breakdown']))
    await generateScript('vid-2', PLAYBOOK, BRIEF, baseConfig(['legal-procedure-explainer']))

    expect(capturedBodies).toHaveLength(2)
    const [a, b] = capturedBodies

    // The `system` is a structured array with the stable prefix plus the framing.
    expect(Array.isArray(a.system)).toBe(true)
    expect(a.system.length).toBeGreaterThanOrEqual(2)
    expect(b.system.length).toBeGreaterThanOrEqual(2)

    // (a) The cached prefix (block 0) is byte-identical across the two videos.
    expect(a.system[0].text.length).toBeGreaterThan(0)
    expect(a.system[0].text).toBe(b.system[0].text)

    // (b) ONLY the first block carries the cache breakpoint.
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' })
    for (const block of a.system.slice(1)) expect(block.cache_control).toBeUndefined()
    for (const block of b.system.slice(1)) expect(block.cache_control).toBeUndefined()

    // (c) The differing editorial framing lives OUTSIDE the cached first block.
    const framingA = 'forensic breakdown' // humanizeAngle('forensic-breakdown')
    const framingB = 'legal procedure explainer'
    expect(a.system[0].text).not.toContain(framingA)
    expect(b.system[0].text).not.toContain(framingB)

    const restA = JSON.stringify(a.system.slice(1))
    const restB = JSON.stringify(b.system.slice(1))
    expect(restA).toContain(framingA)
    expect(restB).toContain(framingB)
    expect(restA).not.toContain(framingB)
    expect(restB).not.toContain(framingA)
  })
})
