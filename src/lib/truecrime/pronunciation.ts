// Pronunciation-normalization pass (issue #51). Runs on the narration text just
// before TTS so the voice engine stops butchering the words these niches are
// built on: acronyms (it says "fibby" for FBI), proper nouns, and year numbers.
//
// The one hard constraint here is CAPTIONS. In the Kokoro captioned path the
// burned-in caption text is built from the SPOKEN word stamps, so if we naively
// send "F B I" / "guh-DAH-fee" to the engine those strings would ALSO appear on
// screen. To avoid that regression this pass is "display-aware": every change is
// recorded as a { display, spoken } segment. `spoken` is what the TTS engine
// hears; `display` is the original spelling the caption stage relabels back to
// (see relabelStampsToDisplay in captions.ts). So the viewer HEARS the fix and
// READS the original word.
//
// The transforms are deliberately conservative — a handful of regex rules plus
// an editable lexicon — not a general number-to-words engine. Everything in this
// file is PURE (lexicon is injected); the DB-backed lexicon resolver lives in
// tts.ts so this stays trivially unit-testable.

import { DEFAULT_LEXICON, type Lexicon } from './pronunciation.lexicon'
import type { NormSegment } from './types'

export type { Lexicon } from './pronunciation.lexicon'
export type { NormSegment } from './types'

export interface NormalizeResult {
  /** Full text handed to the TTS engine (spoken forms joined by spaces). */
  spoken: string
  /** Ordered per-word cover of the ORIGINAL text; drives caption relabelling. */
  segments: NormSegment[]
  /** True when at least one word was changed (lets callers skip work). */
  changed: boolean
}

/** Collapse a token to the letters/digits that a word stamp would carry, so we
 *  can compare "F B I" against stamps ["F","B","I"] or "raided." against
 *  "raided" without punctuation getting in the way. Exported for the caption
 *  relabeller, which reconstructs the same way. */
export function speechKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// Pronounceable acronyms that must NOT be spaced out — they read as a word.
const SAY_AS_WORD = new Set([
  'NASA', 'NATO', 'SWAT', 'AIDS', 'UNESCO', 'UNICEF', 'SCUBA', 'LASER', 'RADAR',
  'OPEC', 'FIFA', 'NAFTA', 'GIF', 'PIN', 'AWOL', 'POTUS',
])

// Roman numerals (I..XX-ish) — regnal names ("Henry VIII") must never be spaced.
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Speak an integer 0–99 the natural way ("forty-two"). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = n % 10
  return o ? `${t}-${ONES[o]}` : t
}

/** Speak a 4-digit year the way a person reads it: 1995 → "nineteen ninety-five",
 *  2010 → "twenty ten", 2005 → "two thousand five", 1900 → "nineteen hundred". */
function sayYear(y: number): string {
  const hi = Math.floor(y / 100)
  const lo = y % 100
  if (y % 1000 === 0) return `${twoDigits(y / 1000)} thousand` // 2000 → "two thousand"
  if (hi % 10 === 0 && lo < 10 && lo > 0) {
    // 2005 → "two thousand five"; 1005 handled the same, close enough for narration
    return `${twoDigits(hi / 10)} thousand${lo ? ` ${twoDigits(lo)}` : ''}`
  }
  if (lo === 0) return `${twoDigits(hi)} hundred` // 1900 → "nineteen hundred"
  return `${twoDigits(hi)} ${twoDigits(lo)}` // 1995 → "nineteen ninety-five"
}

/** The spoken form of a single whitespace token, or null if it's left alone.
 *  Order matters: lexicon respelling wins over the generic acronym/number rules
 *  so a curated pronunciation is never re-mangled. */
function spokenForm(token: string, lex: Lexicon): string | null {
  // Split any leading/trailing punctuation off the core word so "FBI." still matches.
  const m = token.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u)
  const lead = m?.[1] ?? ''
  const core = m?.[2] ?? token
  const trail = m?.[3] ?? ''
  if (!core) return null

  const wrap = (s: string) => `${lead}${s}${trail}`

  // 1. Lexicon respelling (case-insensitive, single-token keys).
  const hit = lex.respell[core.toLowerCase()]
  if (hit) return wrap(hit)

  // 2. Acronyms: 2–5 letters, all caps (dots allowed: F.B.I.). Spaced out unless
  //    they read as a word or are a Roman numeral. Force list overrides the guard.
  const bare = core.replace(/\./g, '')
  const forced = lex.acronyms.includes(bare.toUpperCase())
  if (forced || (/^[A-Z]{2,5}$/.test(bare) && !SAY_AS_WORD.has(bare) && !ROMAN_RE.test(bare))) {
    return wrap(bare.toUpperCase().split('').join(' '))
  }

  // 3. Four-digit years (1000–2099) → read as a person would.
  if (/^\d{4}$/.test(core)) {
    const y = parseInt(core, 10)
    if (y >= 1000 && y <= 2099) return wrap(sayYear(y))
  }

  // 4. Decades: 1980s → "nineteen eighties".
  const dec = core.match(/^(1[5-9]\d0|20\d0)s$/)
  if (dec) {
    const base = parseInt(dec[1], 10)
    const hi = Math.floor(base / 100)
    const lo = base % 100
    const decade = lo === 0 ? 'hundreds' : `${twoDigits(lo).replace(/y$/, 'ies')}`
    return wrap(lo === 0 ? `${twoDigits(hi)} hundreds` : `${twoDigits(hi)} ${decade}`)
  }

  return null
}

/**
 * Normalize narration for speech. Tokenizes on whitespace, computes the spoken
 * form of each token, and returns both the joined spoken string and the ordered
 * { display, spoken } segments used to keep captions on the original spelling.
 */
export function normalizeForSpeech(text: string, lexicon: Lexicon = DEFAULT_LEXICON): NormalizeResult {
  const tokens = text.split(/\s+/).filter(Boolean)
  const segments: NormSegment[] = []
  let changed = false
  for (const tok of tokens) {
    const spoken = spokenForm(tok, lexicon)
    if (spoken !== null && spoken !== tok) {
      segments.push({ display: tok, spoken })
      changed = true
    } else {
      segments.push({ display: tok, spoken: tok })
    }
  }
  return { spoken: segments.map((s) => s.spoken).join(' '), segments, changed }
}
