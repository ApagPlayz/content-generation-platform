// Proves the Anthropic prompt-cache is actually EFFECTIVE for the true-crime
// script stage (issue #90). The `cache_control` breakpoint only saves money if
// the cached prefix (system block 0) is byte-identical across videos. The
// per-video editorial framing rotates every run by design (pickDivergentStyle),
// so it must live OUTSIDE the cached block, or it busts the prefix on every
// single video and the cache is written but never read. This test locks that in:
// it drives two real AI-path calls with DIFFERENT editorial angles and asserts
// the cached prefix stays identical while the rotating framing moves to an
// uncached tail block.
//
// (Structural invariance is all a unit test can prove; actual cache HITS also
// require block 0 to exceed the model's minimum cacheable prefix and are only
// observable against the live API via cache_read_input_tokens.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateScript } from './script'
import type { CaseBrief, F10FactoryConfig } from './types'

// prisma is the only module needing a mock: costLedger.create is a no-op,
// complianceReport.findMany returns [] (empty style corpus → the angle pick is
// driven purely by config), and setting.findUnique/findMany return null/[] so
// resolveModel falls back to its default tier. resolveModel/claudeCallCost,
// styleVariation and scoreHookCandidate are all pure given that.
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

// Minimal JSON buildFromModel accepts (a non-empty hook.verbal + enough non-empty
// beats). Its exact content is irrelevant here — we only inspect the REQUEST body.
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

// A single-element editorialAngles pool makes pickDivergentStyle deterministic:
// leastRecentlyUsed over a one-item pool always returns that item. Two DIFFERENT
// pools across the two calls therefore force two different angles — exactly the
// scenario that used to bust the cache.
function configWithAngle(angle: string): F10FactoryConfig {
  return {
    useAiScript: true,
    scriptModel: 'sonnet5',
    targetDurationSec: 75,
    editorialAngles: [angle],
    enableEditorialLayer: true,
  }
}

describe('generateScript — Anthropic prompt-cache prefix is stable across videos', () => {
  it('keeps the cached system block byte-identical while the rotating framing lives in an uncached tail block', async () => {
    // 'investigation' → framing 'investigative breakdown';
    // 'forensics'     → framing 'forensic breakdown' (see angleCopyFor).
    await generateScript('vid-1', PLAYBOOK, BRIEF, configWithAngle('investigation'))
    await generateScript('vid-2', PLAYBOOK, BRIEF, configWithAngle('forensics'))

    expect(capturedBodies).toHaveLength(2)
    const [a, b] = capturedBodies

    expect(Array.isArray(a.system)).toBe(true)
    expect(a.system.length).toBeGreaterThanOrEqual(2)
    expect(b.system.length).toBeGreaterThanOrEqual(2)

    // (a) The cached prefix (block 0) is byte-identical across the two videos —
    // the load-bearing invariance proof.
    expect(a.system[0].text.length).toBeGreaterThan(0)
    expect(a.system[0].text).toBe(b.system[0].text)

    // (b) ONLY the first block carries the cache breakpoint.
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(a.system.filter((blk) => blk.cache_control).length).toBe(1)
    expect(b.system.filter((blk) => blk.cache_control).length).toBe(1)

    // (c) The rotating framing is OUT of the cached block…
    expect(a.system[0].text).not.toContain('EDITORIAL FRAMING')
    expect(a.system[0].text).not.toContain('investigative breakdown')
    expect(b.system[0].text).not.toContain('forensic breakdown')

    // …and IN the uncached tail block, and it genuinely differs between videos.
    expect(a.system[1].cache_control).toBeUndefined()
    expect(a.system[1].text).toContain('EDITORIAL FRAMING')
    expect(a.system[1].text).toContain('investigative breakdown')
    expect(b.system[1].text).toContain('forensic breakdown')
    expect(a.system[1].text).not.toBe(b.system[1].text)

    // (d) The framing's own compliance guard moved intact with it.
    expect(a.system[1].text).toContain('never introduce a new accusation')
    expect(a.system[1].text).toContain('attributed and hedged')
  })

  it('omits the editorial block entirely (but keeps the cached prefix identical) when the editorial layer is off', async () => {
    await generateScript('vid-on', PLAYBOOK, BRIEF, configWithAngle('investigation'))
    await generateScript('vid-off', PLAYBOOK, BRIEF, {
      ...configWithAngle('investigation'),
      enableEditorialLayer: false,
    })

    const [withLayer, withoutLayer] = capturedBodies
    expect(withoutLayer.system).toHaveLength(1)
    expect(withoutLayer.system[0].cache_control).toEqual({ type: 'ephemeral' })
    // Turning the layer off must not disturb the cached prefix.
    expect(withoutLayer.system[0].text).toBe(withLayer.system[0].text)
  })
})
