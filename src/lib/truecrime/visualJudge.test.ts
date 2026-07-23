// Tests for the AI relevance judge (src/lib/truecrime/visualJudge.ts):
//   1. Prompt building (numbering, topic/angle, per-kind rules).
//   2. Defensive verdict parsing (1-based→0-based, out-of-range, omissions,
//      embedded-in-prose, unparseable → null).
//   3. judgeVisualCandidates orchestration: fail-soft fallbacks (no key, API
//      error, throw, unparseable) and a happy-path rejection with mocked fetch.
// No network or DB: the API is mocked via the injected `fetchImpl`, and the
// keyless path short-circuits before any fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildJudgeMessages,
  judgeSystemPrompt,
  judgeVisualCandidates,
  keepAll,
  MAX_JUDGE_CANDIDATES,
  parseVerdicts,
  type JudgeCandidate,
} from './visualJudge'
import type { ResolvedModel } from '../settings'

const STUB_MODEL: ResolvedModel = {
  tier: 'sonnet5',
  model: 'claude-sonnet-5',
  inputCostPerToken: 0,
  outputCostPerToken: 0,
}

/** A Claude-shaped response wrapping a text body. */
function apiResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }),
  } as unknown as Response
}

describe('judgeSystemPrompt', () => {
  it('tells clips to reject fiction features / dramatizations / compilations', () => {
    const p = judgeSystemPrompt('clip')
    expect(p.toLowerCase()).toContain('fiction')
    expect(p.toLowerCase()).toContain('compilation')
    expect(p.toLowerCase()).toContain('newsreel')
  })
  it('tells photos to reject book covers / autograph pages / generic filler', () => {
    const p = judgeSystemPrompt('photo')
    expect(p.toLowerCase()).toContain('book cover')
    expect(p.toLowerCase()).toContain('autograph')
  })
  it('always demands a strict JSON array with i/keep/reason', () => {
    for (const kind of ['clip', 'photo'] as const) {
      const p = judgeSystemPrompt(kind)
      expect(p).toContain('"i"')
      expect(p).toContain('"keep"')
      expect(p).toMatch(/JSON array/i)
    }
  })
})

describe('buildJudgeMessages', () => {
  it('numbers candidates 1-based and carries topic + angle + description + source', () => {
    const cands: JudgeCandidate[] = [
      { title: 'Plow that Broke the Plains', description: 'US gov documentary', source: 'archive.org' },
      { title: 'The Grapes of Wrath (1940)', source: 'youtube' },
    ]
    const { system, user } = buildJudgeMessages('The Dust Bowl', 'archival breakdown', cands, 'clip')
    expect(system).toBe(judgeSystemPrompt('clip'))
    expect(user).toContain('Topic/event: The Dust Bowl')
    expect(user).toContain('Editorial angle: archival breakdown')
    expect(user).toContain('1. Plow that Broke the Plains — US gov documentary [archive.org]')
    expect(user).toContain('2. The Grapes of Wrath (1940) [youtube]')
  })
  it('falls back to "(none given)" when there is no angle', () => {
    const { user } = buildJudgeMessages('X', '', [{ title: 'a' }], 'photo')
    expect(user).toContain('Editorial angle: (none given)')
  })
})

describe('parseVerdicts', () => {
  it('maps a clean 1-based array onto 0-based verdicts', () => {
    const text = '[{"i":1,"keep":true},{"i":2,"keep":false,"reason":"fiction film"},{"i":3,"keep":true}]'
    const v = parseVerdicts(text, 3)
    expect(v).toEqual([
      { index: 0, keep: true, reason: undefined },
      { index: 1, keep: false, reason: 'fiction film' },
      { index: 2, keep: true, reason: undefined },
    ])
  })
  it('extracts a JSON array embedded in surrounding prose', () => {
    const text = 'Here are my verdicts:\n[{"i":1,"keep":false}]\nThanks!'
    const v = parseVerdicts(text, 1)
    expect(v?.[0]).toEqual({ index: 0, keep: false, reason: undefined })
  })
  it('ignores out-of-range indices and keeps omitted candidates by default', () => {
    // Only candidate 2 judged (rejected); 1 and 3 omitted → default keep. Index 9 ignored.
    const text = '[{"i":9,"keep":false},{"i":2,"keep":false}]'
    const v = parseVerdicts(text, 3)
    expect(v).toEqual([
      { index: 0, keep: true, reason: 'not-judged' },
      { index: 1, keep: false, reason: undefined },
      { index: 2, keep: true, reason: 'not-judged' },
    ])
  })
  it('treats keep:"true"/1 as truthy and anything else as reject', () => {
    const v = parseVerdicts('[{"i":1,"keep":"true"},{"i":2,"keep":1},{"i":3,"keep":"yes"}]', 3)
    expect(v?.map((x) => x.keep)).toEqual([true, true, false])
  })
  it('returns null when there is no array at all', () => {
    expect(parseVerdicts('no json here', 3)).toBeNull()
    expect(parseVerdicts('{"i":1,"keep":true}', 3)).toBeNull() // object, not array
  })
  it('returns null when the array parses but yields no usable verdicts', () => {
    expect(parseVerdicts('[{"nope":1},{"x":2}]', 3)).toBeNull()
  })
})

describe('keepAll', () => {
  it('keeps every candidate with a heuristic-fallback reason', () => {
    expect(keepAll(2)).toEqual([
      { index: 0, keep: true, reason: 'heuristic-fallback' },
      { index: 1, keep: true, reason: 'heuristic-fallback' },
    ])
    expect(keepAll(0)).toEqual([])
  })
})

describe('judgeVisualCandidates — fail-soft fallbacks', () => {
  const savedAnthropic = process.env.ANTHROPIC_API_KEY
  const savedClaude = process.env.CLAUDE_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_API_KEY
    vi.restoreAllMocks()
  })
  afterEach(() => {
    if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic
    if (savedClaude !== undefined) process.env.CLAUDE_API_KEY = savedClaude
  })

  it('returns [] for an empty candidate list without calling the API', async () => {
    const fetchImpl = vi.fn()
    const v = await judgeVisualCandidates('X', '', [], 'clip', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(v).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps all (heuristic) when no API key is present, never calling fetch', async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error('must not be called')
    })
    const cands: JudgeCandidate[] = [{ title: 'a' }, { title: 'b' }]
    const v = await judgeVisualCandidates('X', '', cands, 'clip', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(v).toEqual(keepAll(2))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps all on a non-OK API response', async () => {
    const fetchImpl = vi.fn(async () => apiResponse('', false, 500))
    const v = await judgeVisualCandidates('X', '', [{ title: 'a' }], 'clip', {
      apiKey: 'k',
      resolvedModel: STUB_MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(v).toEqual(keepAll(1))
  })

  it('keeps all when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    const v = await judgeVisualCandidates('X', '', [{ title: 'a' }, { title: 'b' }], 'photo', {
      apiKey: 'k',
      resolvedModel: STUB_MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(v).toEqual(keepAll(2))
  })

  it('keeps all when the reply is unparseable', async () => {
    const fetchImpl = vi.fn(async () => apiResponse('I cannot produce JSON.'))
    const v = await judgeVisualCandidates('X', '', [{ title: 'a' }], 'clip', {
      apiKey: 'k',
      resolvedModel: STUB_MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(v).toEqual(keepAll(1))
  })
})

describe('judgeVisualCandidates — happy path (mocked API)', () => {
  it('parses the verdict and rejects the fiction feature', async () => {
    const cands: JudgeCandidate[] = [
      { title: 'The Plow that Broke the Plains', source: 'archive.org' },
      { title: 'The Grapes of Wrath (1940)', source: 'youtube' },
      { title: 'The High Command (1937 drama)', source: 'archive.org' },
    ]
    const body =
      '[{"i":1,"keep":true,"reason":"real gov documentary"},' +
      '{"i":2,"keep":false,"reason":"fiction feature"},' +
      '{"i":3,"keep":false,"reason":"unrelated drama"}]'
    const fetchImpl = vi.fn(async () => apiResponse(body))
    const v = await judgeVisualCandidates('The Dust Bowl (1934)', 'archival breakdown', cands, 'clip', {
      apiKey: 'k',
      resolvedModel: STUB_MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(v.map((x) => x.keep)).toEqual([true, false, false])
    // Verify the request actually carried the numbered candidates + clip rules.
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(call[1].body as string)
    expect(sent.model).toBe('claude-sonnet-5')
    expect(sent.system[0].text).toContain('fiction')
    expect(sent.messages[0].content).toContain('2. The Grapes of Wrath (1940)')
  })

  it('truncates the candidate list to MAX_JUDGE_CANDIDATES', async () => {
    const many: JudgeCandidate[] = Array.from({ length: MAX_JUDGE_CANDIDATES + 5 }, (_, i) => ({ title: `c${i}` }))
    const fetchImpl = vi.fn(async () => apiResponse('[{"i":1,"keep":true}]'))
    const v = await judgeVisualCandidates('X', '', many, 'clip', {
      apiKey: 'k',
      resolvedModel: STUB_MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(v).toHaveLength(MAX_JUDGE_CANDIDATES)
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(call[1].body as string)
    // The last (31st+) candidate must not appear in the prompt.
    expect(sent.messages[0].content).not.toContain(`c${MAX_JUDGE_CANDIDATES}`)
  })
})
