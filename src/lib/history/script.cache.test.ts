// Same contract as truecrime/script.cache.test.ts, for the history/business
// factory (issue #90): the Anthropic cached system prefix (block 0) must stay
// byte-stable across videos, with the per-video editorial framing kept OUTSIDE
// the cached block so the prompt-cache is actually read instead of re-written
// every run. Drives two real AI-path calls with DIFFERENT angles and proves the
// cached prefix is invariant while the rotating framing moves to an uncached
// tail block.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateHistoryScript } from './script'
import type { F11FactoryConfig, TopicBrief } from './types'

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

// BEATS_60 for history is 6 specs (need >= ceil(6/2)=3 non-empty). The 7-beat
// payload still satisfies buildFromModel (extra beats are ignored).
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

interface SystemBlock {
  type: string
  text: string
  cache_control?: { type: string }
}
interface CapturedBody {
  system: SystemBlock[]
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

function configWithAngle(angle: string): F11FactoryConfig {
  return {
    useAiScript: true,
    scriptModel: 'sonnet5',
    targetDurationSec: 75, // => BEATS_60 (6 beats)
    editorialAngles: [angle],
    enableEditorialLayer: true,
  }
}

describe('generateHistoryScript — Anthropic prompt-cache prefix is stable across videos', () => {
  it('keeps the cached system block byte-identical while the rotating framing lives in an uncached tail block', async () => {
    // 'business-postmortem' → framing 'business postmortem';
    // 'myth-vs-record'      → framing 'myth-versus-record check' (see angleCopyFor).
    await generateHistoryScript('vid-1', PLAYBOOK, BRIEF, configWithAngle('business-postmortem'))
    await generateHistoryScript('vid-2', PLAYBOOK, BRIEF, configWithAngle('myth-vs-record'))

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
    expect(a.system.filter((blk) => blk.cache_control).length).toBe(1)
    expect(b.system.filter((blk) => blk.cache_control).length).toBe(1)

    // (c) The rotating framing is OUT of the cached block…
    expect(a.system[0].text).not.toContain('EDITORIAL FRAMING')
    expect(a.system[0].text).not.toContain('business postmortem')
    expect(b.system[0].text).not.toContain('myth-versus-record check')

    // …and IN the uncached tail block, and it genuinely differs between videos.
    expect(a.system[1].cache_control).toBeUndefined()
    expect(a.system[1].text).toContain('EDITORIAL FRAMING')
    expect(a.system[1].text).toContain('business postmortem')
    expect(b.system[1].text).toContain('myth-versus-record check')
    expect(a.system[1].text).not.toBe(b.system[1].text)

    // (d) The framing's own compliance guard moved intact with it.
    expect(a.system[1].text).toContain('never introduce a new accusation')
    expect(a.system[1].text).toContain('attributed and hedged')
  })

  it('omits the editorial block entirely (but keeps the cached prefix identical) when the editorial layer is off', async () => {
    await generateHistoryScript('vid-on', PLAYBOOK, BRIEF, configWithAngle('business-postmortem'))
    await generateHistoryScript('vid-off', PLAYBOOK, BRIEF, {
      ...configWithAngle('business-postmortem'),
      enableEditorialLayer: false,
    })

    const [withLayer, withoutLayer] = capturedBodies
    expect(withoutLayer.system).toHaveLength(1)
    expect(withoutLayer.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(withoutLayer.system[0].text).toBe(withLayer.system[0].text)
  })
})
