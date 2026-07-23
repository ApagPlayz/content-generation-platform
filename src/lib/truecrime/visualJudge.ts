// AI relevance vetting for the visual-sourcing pipeline (added 2026-07-22).
//
// Token/phrase heuristics kept passing WRONG footage into finished videos: the
// "Dust Bowl (1934)" proof shipped a fiction feature ("The Grapes of Wrath"),
// an unrelated 1937 drama ("The High Command" → a modern colour Niagara Falls
// aerial), and a meaningless "Autographs" book-cover photo — all of which the
// title-token filter waved through. Earlier a "Time Tunnel" TV compilation also
// slipped past. Titles alone can't tell a real newsreel from a Hollywood film
// with the same keywords.
//
// This module reuses the SAME Claude infrastructure the script stage already
// uses (one batched API call, defensive JSON parse, offline fallback) to JUDGE
// a numbered list of candidates and return a keep/reject verdict per candidate.
//
// COST: exactly ONE call per media type per video. Candidate lists are truncated
// to MAX_JUDGE_CANDIDATES. FAIL-SOFT: no API key, an API error, or an unparseable
// reply falls back to keeping every candidate (i.e. the caller's existing
// heuristic ordering) — judging must never crash a run.

import { prisma } from '../prisma'
import { resolveModel, claudeCallCost, MODEL_BY_TIER, type ResolvedModel } from '../settings'

/** clip = moving footage (archive.org / YouTube); photo = still image. The two
 *  have different accept/reject rules, so the prompt differs by kind. */
export type JudgeMediaKind = 'clip' | 'photo'

/** One candidate handed to the judge. Only the human-readable signal — no file
 *  handles — so this module stays free of the download machinery. */
export interface JudgeCandidate {
  title: string
  /** Extra context (channel, blurb) — optional; sharpens borderline calls. */
  description?: string
  /** Where it came from (e.g. 'archive.org', 'youtube', 'wikimedia'). */
  source?: string
}

/** Verdict for the candidate at `index` (0-based, into the JUDGED window). */
export interface JudgeVerdict {
  index: number
  keep: boolean
  reason?: string
}

export interface JudgeOptions {
  /** When set, the call's cost is written to the CostLedger (best-effort). */
  videoId?: string
  /** Claude tier or model id — same config the script stage uses. Default sonnet5. */
  model?: string
  /** Override the API key (else ANTHROPIC_API_KEY / CLAUDE_API_KEY from env). */
  apiKey?: string
  /** Inject fetch for offline unit tests. */
  fetchImpl?: typeof fetch
  /** Skip resolveModel (which reads the DB) — for offline unit tests. */
  resolvedModel?: ResolvedModel
}

/** Hard cap on candidates sent in one call — keeps the prompt (and cost) bounded. */
export const MAX_JUDGE_CANDIDATES = 30

/** Fallback verdict set: keep everything, preserving the caller's heuristic order. */
export function keepAll(count: number): JudgeVerdict[] {
  const out: JudgeVerdict[] = []
  for (let i = 0; i < count; i++) out.push({ index: i, keep: true, reason: 'heuristic-fallback' })
  return out
}

/** The strict per-kind judging instructions (the system prompt). Pure/exported
 *  so the wording is unit-testable. */
export function judgeSystemPrompt(kind: JudgeMediaKind): string {
  const common =
    'You are a STRICT relevance judge for a faceless documentary SHORT about ONE ' +
    'specific historical topic or event. You receive a numbered list of candidate ' +
    'visual sources an automated search returned. Decide which to KEEP and which to ' +
    'REJECT. Being too strict costs one fewer asset; being too loose puts OFF-TOPIC ' +
    'footage in the finished video, which is the failure we are fixing. When genuinely ' +
    'unsure whether a candidate really depicts THIS topic, REJECT it.\n\n'

  if (kind === 'clip') {
    return (
      common +
      'These are MOVING CLIPS. KEEP a candidate ONLY if BOTH hold:\n' +
      '  (a) it is genuinely about THIS specific topic/event — not merely the same ' +
      'era, region, or a loosely associated subject; AND\n' +
      '  (b) it is ACTUAL footage of the event: real newsreel, documentary, archival, ' +
      'government, or news film of what happened.\n\n' +
      'REJECT:\n' +
      '  - fiction FEATURE FILMS, dramatizations, re-enactments, and narrative movies ' +
      'ABOUT the event (e.g. a Hollywood film of the story) — UNLESS the topic itself ' +
      'IS that specific film;\n' +
      '  - TV series, single episodes, and multi-topic COMPILATIONS where the topic is ' +
      'only one segment;\n' +
      '  - anything about a different event, person, place, or a modern unrelated subject;\n' +
      '  - generic stock or era mood footage that is not of this event.\n\n' +
      formatInstruction()
    )
  }
  return (
    common +
    'These are STILL IMAGES (from the topic\'s Wikipedia article and Commons searches). ' +
    'KEEP a candidate ONLY if BOTH hold:\n' +
    '  (a) it is genuinely about THIS specific topic/event or its central people/places; AND\n' +
    '  (b) it is VISUALLY MEANINGFUL for a documentary short: a real photograph, scene, ' +
    'portrait, contextual map, document, or artwork a viewer would recognise as ' +
    'illustrating the story.\n\n' +
    'REJECT:\n' +
    '  - book covers, title pages, autograph pages, stamps, coins, generic objects, ' +
    'logos, seals, and decorative filler that carry no visual information about the event;\n' +
    '  - images of a DIFFERENT subject that merely share a keyword;\n' +
    '  - anything you would not put on screen in a serious documentary about this topic.\n\n' +
    formatInstruction()
  )
}

function formatInstruction(): string {
  return (
    'Respond with ONLY a JSON array, one object per candidate, IN THE GIVEN ORDER, each ' +
    'exactly: {"i": <candidate number>, "keep": <true|false>, "reason": "<≤10 words>"}. ' +
    'Judge every candidate. Output no prose outside the JSON array.'
  )
}

/** Build the {system, user} pair for a judging call. Pure/exported for tests. */
export function buildJudgeMessages(
  topic: string,
  angle: string,
  candidates: JudgeCandidate[],
  kind: JudgeMediaKind
): { system: string; user: string } {
  const lines = candidates.map((c, i) => {
    const bits = [`${i + 1}. ${c.title || '(untitled)'}`]
    if (c.description) bits.push(`— ${c.description}`)
    if (c.source) bits.push(`[${c.source}]`)
    return bits.join(' ')
  })
  const user =
    `Topic/event: ${topic}\n` +
    `Editorial angle: ${angle || '(none given)'}\n\n` +
    `Candidates:\n${lines.join('\n')}`
  return { system: judgeSystemPrompt(kind), user }
}

/**
 * Parse the model's JSON verdict array defensively (same tolerance posture as
 * script.ts). Returns one verdict per candidate index [0, count); a candidate
 * the model omitted defaults to keep (fail-open per-candidate). Returns null —
 * signalling the caller to fall back to keepAll — when nothing parses at all.
 * Pure/exported for tests.
 */
export function parseVerdicts(text: string, count: number): JudgeVerdict[] | null {
  const match = (text || '').match(/\[[\s\S]*\]/)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const decided = new Map<number, { keep: boolean; reason?: string }>()
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const n = Number(item.i ?? item.index ?? item.n)
    if (!Number.isFinite(n)) continue
    const idx = Math.round(n) - 1 // 1-based in the prompt → 0-based here
    if (idx < 0 || idx >= count) continue
    const keep = item.keep === true || item.keep === 'true' || item.keep === 1
    const reason = typeof item.reason === 'string' ? item.reason.slice(0, 120) : undefined
    if (!decided.has(idx)) decided.set(idx, { keep, reason })
  }
  if (decided.size === 0) return null // model replied but nothing usable → fail-soft

  const out: JudgeVerdict[] = []
  for (let i = 0; i < count; i++) {
    const d = decided.get(i)
    out.push({ index: i, keep: d ? d.keep : true, reason: d?.reason ?? (d ? undefined : 'not-judged') })
  }
  return out
}

/**
 * Judge a candidate list with ONE batched Claude call. Returns a verdict per
 * candidate (truncated to MAX_JUDGE_CANDIDATES). Never throws: no key / API
 * error / unparseable reply all fall back to keepAll (heuristic ordering).
 */
export async function judgeVisualCandidates(
  topic: string,
  angle: string,
  candidates: JudgeCandidate[],
  kind: JudgeMediaKind,
  opts: JudgeOptions = {}
): Promise<JudgeVerdict[]> {
  const list = candidates.slice(0, MAX_JUDGE_CANDIDATES)
  if (list.length === 0) return []

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY
  if (!apiKey) {
    console.warn(`[visualJudge] no API key — keeping all ${list.length} ${kind} candidates (heuristic fallback)`)
    return keepAll(list.length)
  }

  // Resolve the model tier; if the settings DB is unreachable, use a safe default
  // rather than aborting the judge (still cheaper/better than no judging).
  let m: ResolvedModel
  if (opts.resolvedModel) {
    m = opts.resolvedModel
  } else {
    try {
      m = await resolveModel(opts.model ?? 'sonnet5')
    } catch {
      m = { tier: 'sonnet5', model: MODEL_BY_TIER.sonnet5, inputCostPerToken: 0, outputCostPerToken: 0 }
    }
  }

  try {
    const { system, user } = buildJudgeMessages(topic, angle, list, kind)
    const fetchImpl = opts.fetchImpl ?? fetch
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: m.model,
        max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      console.warn(`[visualJudge] API ${res.status} — heuristic fallback for ${list.length} ${kind} candidates`)
      return keepAll(list.length)
    }

    const data = await res.json()

    if (opts.videoId) {
      try {
        const { total, units } = claudeCallCost(data.usage ?? {}, m)
        await prisma.costLedger.create({
          data: { videoId: opts.videoId, service: `${m.model} (judge)`, units, unitCost: m.inputCostPerToken, total },
        })
      } catch {
        /* cost logging is best-effort — never fail a judge over the ledger */
      }
    }

    const text: string = data.content?.[0]?.text ?? ''
    const verdicts = parseVerdicts(text, list.length)
    if (!verdicts) {
      console.warn(`[visualJudge] unparseable verdict — heuristic fallback for ${list.length} ${kind} candidates`)
      return keepAll(list.length)
    }
    const rejected = verdicts.filter((v) => !v.keep).length
    console.log(`[visualJudge] ${kind}: judged ${list.length}, kept ${list.length - rejected}, rejected ${rejected}`)
    return verdicts
  } catch (err) {
    console.warn(`[visualJudge] error (${(err as Error)?.message ?? err}) — heuristic fallback for ${list.length} ${kind} candidates`)
    return keepAll(list.length)
  }
}
