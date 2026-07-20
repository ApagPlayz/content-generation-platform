// Hook gate for the sports factory. On short-form video the first line decides
// everything: a weak opening line = 0 views no matter how good the rest is. So
// the script stage now produces 3-5 candidate opening lines and this module
// picks the strongest one.
//
// Scoring is a PURE, deterministic heuristic — no API call, no randomness, no
// clock. That means:
//   • the keyless template fallback gets a real score too (same code path), and
//   • the whole thing is fully unit-testable (see hookScore.test.ts).
//
// The score is a *predicted* hook strength (a proxy), not a guarantee of views.
// The real "learn which openings actually win" loop needs published-video
// retention data (avgWatchPct from the Metric model) which does not exist until
// the operator connects YouTube and publishes — see issue #18. This file stores
// the foundation (hookScore + hookStyle per video) so that loop can close later.

export interface HookScore {
  /** 0-100, higher = predicted stronger opening line. */
  score: number
  /** Human-readable angle of the winning hook, e.g. "bold number". */
  style: string
  /** Plain-language notes on what earned/lost points — explains the score. */
  reasons: string[]
}

// Small, stable vocab. Kept intentionally short so it stays easy to reason about
// and groups cleanly when the learning loop later buckets hooks by style.
const CURIOSITY_OPENERS =
  /^(why|how|what|when|the reason|nobody|no one|here'?s why|this is why|wait|before you|you won'?t)\b/i
const BIG_CLAIM_TOKENS = /\b(record|first|last|ever|only|fastest|most|worst|best|never|greatest)\b/i
const VAGUE_HEDGES = /\b(maybe|kind of|sort of|pretty good|somewhat|i guess|some)\b/i
const POWER_WORDS =
  /\b(insane|unbelievable|shocking|secret|exposed|forbidden|brutal|impossible|watch|stop|wait|crazy|jaw-dropping)\b/i

// Count emoji / pictographic symbols without depending on the `u` flag's named
// property escapes (keeps the regex portable across TS targets).
function emojiCount(s: string): number {
  const matches = s.match(
    /[‼-㊙\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu
  )
  return matches ? matches.length : 0
}

/**
 * Score a single candidate opening line on three dimensions the issue calls out
 * — curiosity, specificity, pattern-interrupt — plus a length shaping term so
 * the line actually fits the on-screen overlay (~60 chars). Deterministic:
 * identical input always yields an identical result.
 */
export function scoreHook(candidate: string): HookScore {
  const hook = (candidate ?? '').trim()
  const reasons: string[] = []
  let score = 30 // neutral baseline
  let style = 'clear statement'

  if (!hook) {
    return { score: 0, style: 'empty', reasons: ['no opening line'] }
  }

  // ── Curiosity (open loop / intrigue) ─────────────────────────────────────
  if (hook.includes('?')) {
    score += 12
    style = 'curiosity gap'
    reasons.push('asks a question')
  }
  if (CURIOSITY_OPENERS.test(hook)) {
    score += 10
    if (style === 'clear statement') style = 'curiosity gap'
    reasons.push('opens a curiosity loop')
  }
  if (/(\.\.\.|…)/.test(hook)) {
    score += 6
    reasons.push('leaves the thought open')
  }

  // ── Specificity (concrete beats vague) ───────────────────────────────────
  if (/\d/.test(hook)) {
    score += 12
    if (style === 'clear statement') style = 'bold number'
    reasons.push('has a specific number')
  }
  if (BIG_CLAIM_TOKENS.test(hook)) {
    score += 6
    reasons.push('makes a big, concrete claim')
  }
  if (VAGUE_HEDGES.test(hook)) {
    score -= 8
    reasons.push('vague / hedged wording')
  }

  // ── Pattern-interrupt (stops the scroll) ─────────────────────────────────
  if (POWER_WORDS.test(hook)) {
    score += 8
    if (style === 'clear statement') style = 'pattern interrupt'
    reasons.push('scroll-stopping power word')
  }
  const emojis = emojiCount(hook)
  if (emojis === 1) {
    score += 4
    reasons.push('one well-placed emoji')
  } else if (emojis >= 2) {
    score -= 4
    reasons.push('too many emojis (spammy)')
  }

  // ── Length shaping (fit the on-screen overlay, ~60 chars) ────────────────
  const len = hook.length
  if (len >= 20 && len <= 45) {
    score += 8
    reasons.push('good length for the screen')
  } else if ((len >= 10 && len < 20) || (len > 45 && len <= 60)) {
    score += 3
  } else if (len > 60) {
    score -= 10
    reasons.push('too long — overflows the overlay')
  } else {
    score -= 6
    reasons.push('too short to land')
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), style, reasons }
}

/**
 * Score every candidate and return the strongest, plus its score. First
 * candidate wins ties, so this degrades gracefully to "use the first hook" when
 * everything scores equal (or only one was supplied). Empty/whitespace-only
 * candidates are ignored; if none survive it returns an empty hook at score 0.
 */
export function pickBestHook(candidates: string[]): { hook: string; score: HookScore } {
  const cleaned = (candidates ?? []).map((c) => String(c ?? '').trim()).filter(Boolean)
  if (cleaned.length === 0) {
    return { hook: '', score: scoreHook('') }
  }
  let best = { hook: cleaned[0], score: scoreHook(cleaned[0]) }
  for (let i = 1; i < cleaned.length; i++) {
    const s = scoreHook(cleaned[i])
    if (s.score > best.score.score) best = { hook: cleaned[i], score: s }
  }
  return best
}

/**
 * Score the rich hook the true-crime and history factories build (their hook is
 * an object, not a bare string like sports'). The viewer receives that hook as
 * BOTH a spoken opening line (`verbal`, 10-14 words) and a compressed on-screen
 * overlay (`onscreenText`, ≤7 words), so its strength is the stronger of the
 * two: `pickBestHook` scores each and returns the winner. This avoids two
 * biases — the long `verbal` line usually trips the scorer's >60-char length
 * penalty, while the offline template's `onscreenText` is just the case name
 * (no curiosity/number signal) — so scoring either alone would under-report.
 * Reuses the same deterministic scorer sports uses, so the Review Inbox badge
 * means the same thing across all three factories. Empty hook → score 0.
 */
export function scoreHookCandidate(hook: {
  verbal?: string
  onscreenText?: string
} | null | undefined): HookScore {
  return pickBestHook([hook?.onscreenText ?? '', hook?.verbal ?? '']).score
}
