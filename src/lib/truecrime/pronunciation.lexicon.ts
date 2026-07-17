// Seed pronunciation lexicon (issue #51) + the resolver that merges it with the
// owner's editable overrides.
//
// HOW TO ADD A PRONUNCIATION (no code deploy needed):
//   The app reads an optional Setting row `pronunciation_lexicon` (Settings page
//   / DB) holding JSON of the same shape as a Lexicon below, e.g.
//     { "respell": { "gaddafi": "guh-DAH-fee" }, "acronyms": ["DA"] }
//   Those entries are merged ON TOP of the seed here, so the owner can correct a
//   name the moment they hear it wrong, without waiting for a release. Keys in
//   `respell` are matched case-insensitively; write them lower-case.
//
// This file is a plain data + merge module — no heavy logic — so it's cheap to
// extend. The matching/expansion rules live in pronunciation.ts.

import { getSetting } from '../settings'

export interface Lexicon {
  /** lower-cased original word → phonetic respelling spoken by the voice. */
  respell: Record<string, string>
  /** UPPER-CASE acronyms to force letter-by-letter even if they look word-ish. */
  acronyms: string[]
}

/** Universal terms every niche shares. Common acronyms are auto-detected by the
 *  all-caps rule, so only the ambiguous / forced ones need listing here. */
const COMMON: Lexicon = {
  respell: {},
  acronyms: ['DA', 'DUI', 'DWI', 'AKA', 'POV'],
}

// Per-niche seeds. Deliberately small — a starting point the owner grows over
// time. Respell keys are lower-case; values are readable phonetic hints.
const BY_NICHE: Record<'truecrime' | 'history', Lexicon> = {
  truecrime: {
    respell: {
      gaddafi: 'guh-DAH-fee',
      dahmer: 'DOM-er',
      gacy: 'GAY-see',
      bundy: 'BUN-dee',
      ramirez: 'ruh-MEER-ez',
      unabomber: 'YOU-nuh-bom-er',
      versace: 'ver-SAH-chee',
    },
    acronyms: ['APB', 'BOLO'],
  },
  history: {
    respell: {
      caesar: 'SEE-zer',
      pharaoh: 'FAIR-oh',
      versailles: 'ver-SIGH',
      worcester: 'WOOS-ter',
      gloucester: 'GLOSS-ter',
      leicester: 'LESS-ter',
      qatar: 'KUH-tar',
      genghis: 'GENG-gis',
      nguyen: 'WIN',
    },
    acronyms: [],
  },
}

/** The default lexicon used when no niche/override is supplied (unit tests, and
 *  any future caller that doesn't know its niche). */
export const DEFAULT_LEXICON: Lexicon = mergeLexicons(COMMON, BY_NICHE.truecrime)

/** Later lexicons win on conflicts. */
export function mergeLexicons(...parts: Array<Partial<Lexicon> | undefined>): Lexicon {
  const out: Lexicon = { respell: {}, acronyms: [] }
  for (const p of parts) {
    if (!p) continue
    Object.assign(out.respell, p.respell ?? {})
    for (const a of p.acronyms ?? []) if (!out.acronyms.includes(a)) out.acronyms.push(a)
  }
  return out
}

/** Parse the owner's `pronunciation_lexicon` Setting. Bad JSON is ignored (falls
 *  back to the seed) so a fat-fingered edit can never break the TTS stage. */
function parseOverride(raw: string): Partial<Lexicon> | undefined {
  if (!raw.trim()) return undefined
  try {
    const o = JSON.parse(raw) as Partial<Lexicon>
    const respell: Record<string, string> = {}
    for (const [k, v] of Object.entries(o.respell ?? {})) {
      if (typeof v === 'string') respell[k.toLowerCase()] = v
    }
    const acronyms = Array.isArray(o.acronyms)
      ? o.acronyms.filter((a): a is string => typeof a === 'string').map((a) => a.toUpperCase())
      : []
    return { respell, acronyms }
  } catch {
    return undefined
  }
}

/**
 * Resolve the lexicon for a run: common seed → per-niche seed → owner override.
 * The only async/DB touch in the pronunciation feature, kept out of the pure
 * normalizer so that stays unit-testable.
 */
export async function resolveLexicon(niche?: 'truecrime' | 'history'): Promise<Lexicon> {
  const nicheSeed = niche ? BY_NICHE[niche] : undefined
  const override = parseOverride(await getSetting('pronunciation_lexicon'))
  return mergeLexicons(COMMON, nicheSeed, override)
}
