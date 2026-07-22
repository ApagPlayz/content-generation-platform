// Same contract as truecrime/script.cache.test.ts, for the history/business
// factory (issue #90): the Anthropic cached system prefix must stay byte-stable
// across videos, with the per-video editorial framing kept OUTSIDE the cached
// block so the prompt-cache is actually read instead of re-written every run.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateHistoryScript } from './script'
import type { F11FactoryConfig } from './types'
import type { TopicBrief } from './types'

vi.mock('../prisma', () => ({
  prisma: {
    costLedger: { create: vi.fn(async () => ({})) },
    complianceReport: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}))

const PLAYBOOK = 'PLAYBOOK: house tone is calm, documentary, faceless.'

const BRIEF: TopicBrief = {
  caseName: 'The Overnight Trading Firm',
  wikipediaTitle: 'The_Overnight_Trading_Firm',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/The_Overnight_Trading_Firm',
  summary: 'A short factual summary of the documented record for this topic.',
  facts: [
    'The firm was founded in 1998.',
    'It grew to a billion-dollar valuation within two years.',
    'Regulators opened an inquiry in 2001.',
    'The company dissolved the following year.',
  ],
  subjects: [{ name: 'A. Founder', role: 'other', living: false, isMinor: false }],
  year: 1998,
  livingWarnings: [],
}

// BEATS_60 for history is 6 specs (need >= ceil(6/2)=3 non-empty); the 7-beat
// payload still satisfies buildFromModel.
const MODEL_JSON = {
  hook: {
    type: 'open_loop',
    verbal: 'A firm worth a billion dollars vanished in a single year and few asked why',
    onscreenText: 'A billion dollars, gone',
    visualCue: 'vintage newspaper headline, slow push-in',
    opensLoop: 'how a billion-dollar firm dissolved so fast',
    payoffRef: 'The Fallout',
  },
  beats: [
    { name: 'Hook', narration: 'placeholder — overwritten by hook.verbal', complianceFlag: 'factual' },
    { name: 'Context', narration: 'The firm was founded in 1998.', linkWord: 'therefore', complianceFlag: 'factual' },
    { name: 'The Rise', narration: 'It grew to a billion-dollar valuation within two years.', linkWord: 'but', complianceFlag: 'factual' },
    { name: 'The Turning Point', narration: 'Regulators opened an inquiry in 2001.', linkWord: 'therefore', sourceAttribution: 'regulators', complianceFlag: 'attributed' },
    { name: 'The Fallout', narration: 'The company dissolved the following year.', linkWord: 'therefore', complianceFlag: 'factual' },
    { name: 'Legacy / Lesson', narration: 'The account remains documented in the public record.', linkWord: 'therefore', complianceFlag: 'factual' },
    { name: 'Extra', narration: 'A cautionary tale for fast-growth firms.', linkWord: 'therefore', complianceFlag: 'factual' },
  ],
  title: 'The Overnight Trading Firm',
  description: 'A documentary short on a documented rise and fall.',
  hashtags: ['history', 'business', 'documentary', 'storytime', 'didyouknow'],
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

function baseConfig(editorialAngles: string[]): F11FactoryConfig {
  return {
    useAiScript: true,
    scriptModel: 'sonnet5',
    targetDurationSec: 75, // => BEATS_60 (6 beats)
    editorialAngles,
    enableEditorialLayer: true,
  }
}

describe('generateHistoryScript — Anthropic prompt-cache prefix is stable', () => {
  it('keeps the first system block byte-identical while the per-video editorial framing differs', async () => {
    await generateHistoryScript('vid-1', PLAYBOOK, BRIEF, baseConfig(['business-postmortem']))
    await generateHistoryScript('vid-2', PLAYBOOK, BRIEF, baseConfig(['myth-vs-record']))

    expect(capturedBodies).toHaveLength(2)
    const [a, b] = capturedBodies

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
    const framingA = 'business postmortem'
    const framingB = 'myth vs record'
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
