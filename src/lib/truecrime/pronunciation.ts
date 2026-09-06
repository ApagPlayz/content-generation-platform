// Pronunciation stage. Runs on the narration *just before* it is handed to a TTS
// provider, so the voice says "F B I" rather than "fibby", reads 1995 as
// "nineteen ninety-five", and pronounces the handful of names neural voices
// reliably butcher (Gaddafi, Versailles, Antetokounmpo…).
//
// Two rules govern everything here:
//
//  1. **The rewrite is for the ears only.** On-screen captions must still show
//     the ORIGINAL spelling — a viewer should never read "F B I". So the pass
//     returns both the spoken text and a span map (one entry per original
//     whitespace token), and `remapWordStamps` folds the provider's word
//     timings back onto the original words before captions are generated.
//  2. **It can never break narration.** Everything is pure and defensive: bad
//     operator JSON is ignored, unrecognised tokens pass through untouched, and
//     if the provider's timings can't be aligned we return `undefined` so
//     captions fall back to the safe original-text path instead of guessing.
//
// Provider-agnostic by design: plain phonetic respelling is read the same way by
// Kokoro, ElevenLabs, OpenAI tts-1 and macOS `say`, so there is no SSML/IPA
// branching per provider (Kokoro — the free local default — supports no SSML at
// all, which would make phoneme tags a no-op exactly where they matter most).

import type { WordStamp } from './types'

/** One original whitespace token and how many spoken words it became. */
export interface PronunciationSpan {
  /** The token exactly as written in the script — what captions must show. */
  original: string
  /** The token as it should be spoken (may be several words). */
  spoken: string
}

export interface PronunciationRewrite {
  /** The narration to send to the TTS provider. */
  spokenText: string
  /** One span per whitespace token of the original narration, in order. */
  spans: PronunciationSpan[]
  /** True when nothing was rewritten (spokenText === narration). */
  unchanged: boolean
}

// ── Built-in lexicon ────────────────────────────────────────────────────────
// Deliberately short and hand-checked. Only words that (a) neural TTS commonly
// gets wrong and (b) are never an ordinary English word in another context —
// a respelling that fires on a common word would be far worse than the original
// mispronunciation. The operator extends this in Settings → Pronunciation.
const BUILTIN_LEXICON: Record<string, string> = {
  // True crime
  gaddafi: 'guh-DAH-fee',
  dahmer: 'DAH-mer',
  gacy: 'GAY-see',
  kaczynski: 'kuh-ZIN-skee',
  desalvo: 'duh-SAL-vo',
  nguyen: 'nwin',
  coroner: 'CORE-uh-ner',
  // Places
  versailles: 'ver-SIGH',
  worcester: 'WOOS-ter',
  leicester: 'LES-ter',
  gloucester: 'GLOSS-ter',
  arkansas: 'AR-kan-saw',
  edinburgh: 'ED-in-burr-uh',
  thames: 'tems',
  qatar: 'KUH-tar',
  yosemite: 'yoh-SEM-it-ee',
  oaxaca: 'wuh-HAH-kuh',
  reykjavik: 'RAKE-yuh-vik',
  spokane: 'spo-KAN',
  tucson: 'TOO-sonn',
  boise: 'BOY-see',
  louisville: 'LOO-ee-vil',
  seoul: 'sole',
  beijing: 'bay-JING',
  // Sport
  giannis: 'YAH-nis',
  antetokounmpo: 'ah-deh-toh-KOON-boh',
  jokic: 'YO-kich',
  doncic: 'DON-chich',
  favre: 'farv',
  krzyzewski: 'sheh-SHEF-skee',
  mahomes: 'muh-HOMES',
  ohtani: 'oh-TAH-nee',
  // History
  nietzsche: 'NEE-chuh',
  goethe: 'GUR-tuh',
  ptolemy: 'TOL-uh-mee',
  chernobyl: 'cher-NOH-bill',
  pompeii: 'pom-PAY',
  genghis: 'GENG-gis',
  sioux: 'soo',
}

/**
 * Read the operator's own entries from the `pronunciation_lexicon` Setting.
 *
 * Accepts either a flat map — `{"gaddafi": "guh-DAH-fee"}` — or the nested
 * `{"respell": {...}}` shape. Any parse failure returns `{}`: a typo in the
 * setting must never be able to stop a video narrating.
 */
export function loadPronunciationLexicon(json: string | undefined | null): Record<string, string> {
  if (!json || !json.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    const source =
      record.respell && typeof record.respell === 'object' && !Array.isArray(record.respell)
        ? (record.respell as Record<string, unknown>)
        : record
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(source)) {
      if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
        out[k.trim().toLowerCase()] = v.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

// ── Number / year reading ───────────────────────────────────────────────────

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const TENS_PLURAL = ['', 'tens', 'twenties', 'thirties', 'forties', 'fifties', 'sixties', 'seventies', 'eighties', 'nineties']

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = n % 10
  return o === 0 ? t : `${t}-${ONES[o]}`
}

/** "1995" → "nineteen ninety-five". Only 1000–2099 — other numbers are left alone. */
export function yearWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 1000 || n > 2099) return null
  const hi = Math.floor(n / 100)
  const lo = n % 100
  if (n >= 2000 && n < 2010) return lo === 0 ? 'two thousand' : `two thousand ${ONES[lo]}`
  if (lo === 0) return `${twoDigitWords(hi)} hundred`
  if (lo < 10) return `${twoDigitWords(hi)} oh ${ONES[lo]}`
  return `${twoDigitWords(hi)} ${twoDigitWords(lo)}`
}

/** "1980s" → "nineteen eighties". Returns null when it isn't a readable decade. */
export function decadeWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 1000 || n > 2099 || n % 10 !== 0) return null
  if (n === 2000) return 'two thousands'
  const hi = Math.floor(n / 100)
  const lo = n % 100
  if (lo === 0) return `${twoDigitWords(hi)} hundreds`
  return `${twoDigitWords(hi)} ${TENS_PLURAL[lo / 10]}`
}

// ── Acronyms ────────────────────────────────────────────────────────────────

// Ordinary English words that also appear in all-caps (headline case, emphasis).
// Spelling these out letter-by-letter would be worse than leaving them alone.
const NOT_ACRONYMS = new Set([
  'A', 'I', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF', 'IN', 'IS', 'IT',
  'ME', 'MY', 'NO', 'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE', 'ALL',
  'AND', 'ANY', 'BUT', 'FOR', 'HAD', 'HAS', 'HER', 'HIM', 'HIS', 'HOW', 'NOT',
  'NOW', 'ONE', 'OUT', 'SHE', 'THE', 'TWO', 'WAS', 'WHO', 'WHY', 'YES', 'YOU',
  'THAT', 'THEN', 'THEY', 'THIS', 'WHAT', 'WHEN', 'NEVER', 'ALWAYS',
])

const ACRONYM_RE = /^[A-Z]{2,6}$/

/** "FBI" → "F B I". Null when the token isn't an acronym worth spelling out. */
export function acronymWords(core: string): string | null {
  if (!ACRONYM_RE.test(core) || NOT_ACRONYMS.has(core)) return null
  return core.split('').join(' ')
}

/**
 * A script written largely in capitals is being SHOUTED, not full of acronyms.
 * Spelling every word out letter-by-letter there would wreck the narration, so
 * the acronym rule switches itself off above this share of all-caps words.
 */
function shoutingScript(tokens: string[]): boolean {
  const words = tokens.map(stripPunctuation).filter((t) => /^[A-Za-z]{2,}$/.test(t.core)).map((t) => t.core)
  if (words.length < 8) return false
  const caps = words.filter((w) => w === w.toUpperCase()).length
  return caps / words.length > 0.3
}

// ── The pass ────────────────────────────────────────────────────────────────

interface Stripped {
  lead: string
  core: string
  trail: string
}

/** Split a token into leading punctuation, its word, and trailing punctuation. */
function stripPunctuation(token: string): Stripped {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(token)
  if (!m) return { lead: '', core: token, trail: '' }
  return { lead: m[1], core: m[2], trail: m[3] }
}

/**
 * Rewrite narration for the ears. Returns the text to speak plus a span per
 * original token, so the original spelling can be restored for captions.
 */
export function preparePronunciation(
  narration: string,
  lexicon: Record<string, string> = {}
): PronunciationRewrite {
  const tokens = narration.split(/\s+/).filter(Boolean)
  const merged = { ...BUILTIN_LEXICON, ...lexicon } // operator entries win
  const allowAcronyms = !shoutingScript(tokens)

  const spans: PronunciationSpan[] = tokens.map((token) => {
    const { lead, core, trail } = stripPunctuation(token)
    const replacement = core ? rewriteCore(core, merged, allowAcronyms) : null
    return {
      original: token,
      spoken: replacement === null ? token : `${lead}${replacement}${trail}`,
    }
  })

  const spokenText = spans.map((s) => s.spoken).join(' ')
  // Compare against the whitespace-normalised original: joining spans always
  // collapses runs of whitespace, so that alone must not count as "changed".
  const unchanged = spokenText === tokens.join(' ')
  return { spokenText, spans, unchanged }
}

/** The one-token rewrite. Null = leave this token exactly as written. */
function rewriteCore(
  core: string,
  lexicon: Record<string, string>,
  allowAcronyms: boolean
): string | null {
  const respelling = lexicon[core.toLowerCase()]
  if (respelling) return respelling

  if (allowAcronyms) {
    const acronym = acronymWords(core)
    if (acronym) return acronym
  }

  if (/^\d{4}$/.test(core)) return yearWords(Number(core))
  const decade = /^(\d{4})s$/i.exec(core)
  if (decade) return decadeWords(Number(decade[1]))

  return null
}

// ── Restoring the original spelling for captions ────────────────────────────

/** Letters and digits only — how we compare a stamp's text to what we expect. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Fold the provider's word timings (which describe the SPOKEN text) back onto
 * the original words, so captions show "FBI" while the voice said "F B I".
 *
 * Alignment is by characters, not token counts, so it survives a provider that
 * tokenises differently from us (splitting "ninety-five", emitting punctuation
 * as its own stamp, and so on). If the two ever genuinely disagree we return
 * `undefined` rather than guess — the caller then falls back to heuristic
 * captions, which are built from the original narration and so are always
 * correct on text, just less precise on timing.
 */
export function remapWordStamps(
  stamps: WordStamp[],
  spans: PronunciationSpan[]
): WordStamp[] | undefined {
  const out: WordStamp[] = []
  let i = 0

  for (const span of spans) {
    const target = normalise(span.spoken)
    if (!target) continue // punctuation-only token — nothing to time

    let acc = ''
    const consumed: WordStamp[] = []
    while (i < stamps.length && acc.length < target.length) {
      acc += normalise(stamps[i].word)
      consumed.push(stamps[i])
      i++
    }
    if (acc !== target || consumed.length === 0) return undefined

    out.push({
      word: span.original,
      startSec: consumed[0].startSec,
      endSec: consumed[consumed.length - 1].endSec,
    })
  }

  // Any leftover stamps must be pure punctuation, or we mis-aligned somewhere.
  for (; i < stamps.length; i++) {
    if (normalise(stamps[i].word)) return undefined
  }

  return out.length ? out : undefined
}
