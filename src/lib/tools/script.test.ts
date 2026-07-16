// Tests the analytics feedback loop's delivery point (Issue #43): the winners
// digest (Agent.memory) must reach the model's USER message so it biases the
// next script — and must NOT be spliced into the cached system prefix (the
// playbook), or every run would bust the prompt cache. Also locks the
// backward-compatible default: no digest ⇒ the request is unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the DB + pricing out of the test — we only care about the request body.
vi.mock('../prisma', () => ({ prisma: { costLedger: { create: vi.fn() } } }))
vi.mock('../settings', () => ({
  resolveModel: vi.fn().mockResolvedValue({
    tier: 'sonnet',
    model: 'claude-test',
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  }),
  claudeCallCost: vi.fn().mockReturnValue({ total: 0, units: 0 }),
}))

import { runScript } from './script'
import type { SourceResult } from './types'

const source: SourceResult = {
  strategy: 'trending_game',
  triggerReason: 'Lakers vs Celtics finished 110-108 (excitement 92/100)',
  youtubeQuery: 'Lakers vs Celtics full game highlights',
  sourceData: { gameId: 1 },
}

// A valid model reply so runScript parses without throwing.
const MODEL_JSON = JSON.stringify({
  title: 'T',
  hooks: ['You have to see this'],
  description: 'd',
  hashtags: ['nba'],
  analysis: ['a'],
  telestration: [],
})

let bodies: string[]

beforeEach(() => {
  bodies = []
  process.env.ANTHROPIC_API_KEY = 'test-key'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body)
      return {
        ok: true,
        json: async () => ({ content: [{ text: MODEL_JSON }], usage: {} }),
      } as unknown as Response
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ANTHROPIC_API_KEY
})

function sent() {
  return JSON.parse(bodies[0]) as {
    system: { text: string }[]
    messages: { role: string; content: string }[]
  }
}

describe('runScript — winners digest wiring', () => {
  const digest = 'What\'s winning (as of 2026-07-16):\n1. "Big dunk" — 40,000 views'

  it('feeds the digest into the USER message, not the cached system prefix', async () => {
    await runScript('v1', 'PLAYBOOK', source, undefined, digest)
    const req = sent()
    expect(req.messages[0].content).toContain('Big dunk')
    expect(req.messages[0].content).toContain('proven winners')
    // The system block is the cached prefix — the per-run digest must stay out.
    expect(req.system[0].text).not.toContain('Big dunk')
  })

  it('leaves the request unchanged when there is no digest yet', async () => {
    await runScript('v1', 'PLAYBOOK', source, undefined, null)
    const withNull = sent().messages[0].content

    bodies = []
    await runScript('v1', 'PLAYBOOK', source, undefined, '   ')
    const withBlank = sent().messages[0].content

    expect(withNull).not.toContain('proven winners')
    // Blank/whitespace memory is treated the same as none.
    expect(withBlank).toBe(withNull)
  })
})
