// Defamation lint — a deterministic pass over the narration. It catches the one
// mistake that gets a true-crime channel sued: stating, as fact, that a named
// living person who has NOT been convicted committed the crime. The rule:
//
//   named living + not-guilt-assertable + guilt-asserting verb + no hedge
//     → BLOCK (this is the lawsuit sentence)
//   named living + not-guilt-assertable + guilt verb but hedged ("allegedly")
//     → WARN (acceptable, but surfaced so the operator can confirm the hedge)
//   a person named with a guilt verb who is NOT in the case's subject list
//     → REVIEW (their legal status was never verified — never auto-publish it)
//   speculation naming "the real killer" in an unsolved case
//     → REVIEW
//
// A stored subject is matched even when the narration uses only their surname
// ("Smith killed her") or first name ("John did it") — not just the exact stored
// full name — because the AI script rarely repeats the full name every sentence.
//
// Pure logic, no API — runs even fully offline, so it's the backstop when the
// corroboration sources are unreachable.

import type { CaseSubject, DefamationFlag, LegalStatusResult } from './types'

// Verbs that assert someone committed the crime. Kept as a raw alternation so the
// sentence-level test and the name-adjacency scan below share one source of truth.
const GUILT_VERB_SRC =
  'murdered|killed|raped|kidnapped|abducted|assaulted|robbed|stabbed|strangled|poisoned|molested|abused|committed|perpetrated|is the killer|is the murderer|is guilty|did it|was responsible for'

const GUILT_VERBS = new RegExp(`\\b(?:${GUILT_VERB_SRC})\\b`, 'i')

// Hedges that make the same sentence legally safe.
const HEDGES =
  /\b(alleged|allegedly|accused|accused of|reportedly|suspected|police say|prosecutors say|charged with|according to|claimed|purported)\b/i

// Speculation about an unnamed perpetrator in an unsolved case.
const REAL_KILLER_SPECULATION = /\b(the real (killer|murderer|perpetrator)|who really did it)\b/i

// Capitalized words that look like names but aren't people — role/title words that
// commonly precede a real name ("Detective Cole"), plus days and months. Lowercased.
const NAME_STOPWORDS = new Set([
  // titles / roles
  'detective', 'detectives', 'officer', 'officers', 'police', 'sergeant', 'sheriff',
  'deputy', 'deputies', 'judge', 'prosecutor', 'prosecutors', 'attorney', 'investigator',
  'investigators', 'authorities', 'agent', 'coroner', 'doctor', 'mr', 'mrs', 'ms', 'dr',
  'captain', 'chief', 'lieutenant', 'marshal', 'warden', 'jury', 'court', 'state', 'county', 'city',
  // days / months
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
])

// First/last names that double as everyday English words. A partial (single-token)
// match on one of these is only trusted when it appears capitalized AND not at the
// very start of the sentence, so "Will the jury decide who killed her?" doesn't
// read as the stored subject "Will Grayson".
const AMBIGUOUS_NAME_WORDS = new Set([
  'will', 'may', 'june', 'april', 'mark', 'grace', 'rose', 'hope', 'drew', 'victor',
  'faith', 'summer', 'dawn', 'art', 'bill', 'rob', 'sunny',
])

// Generational suffixes dropped when tokenizing a stored name.
const SUFFIX_RE = /^(?:jr|sr|ii|iii|iv|v)\.?$/i

// A run of 1–3 Title-Case words — a name-shaped span. Each word is initial-cap +
// two or more lowercase letters, so ALL-CAPS acronyms (FBI, DNA) don't qualify.
const NAME_RUN = '[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]{2,}){0,2}'
// "<Name> [adverb] <guilt verb>" — the accused in subject position.
const NAME_BEFORE_GUILT = new RegExp(`\\b(${NAME_RUN})\\s+(?:\\w+ly\\s+)?(?:${GUILT_VERB_SRC})`, 'g')
// "<guilt verb> by <Name>" — the accused as the passive agent.
const GUILT_BY_NAME = new RegExp(`(?:${GUILT_VERB_SRC})\\s+by\\s+(${NAME_RUN})`, 'gi')

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function titleCase(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

// Distinctive tokens of a stored name: "Det. John Smith Jr." → ["John","Smith"].
// Titles and generational suffixes are dropped; only tokens ≥3 chars are kept for
// partial matching (a short surname like "Ng" is still caught by the full name).
function nameTokens(name: string): string[] {
  return name
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z'’-]/g, ''))
    .filter((t) => t.length >= 3 && !SUFFIX_RE.test(t) && !NAME_STOPWORDS.has(t.toLowerCase()))
}

// Whitespace words with edge punctuation and trailing possessives stripped.
function words(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map((w) => w.replace(/[’']s$/i, '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
    .filter(Boolean)
}

// True if `token` appears in the sentence as a capitalized word (word-boundary, so
// "Smith" ≠ "blacksmith"). For an ambiguous common-word name the sentence-initial
// occurrence is ignored — it's more likely the ordinary word than the person.
function capitalizedTokenPresent(sentence: string, token: string): boolean {
  const target = token.toLowerCase()
  const ambiguous = AMBIGUOUS_NAME_WORDS.has(target)
  const ws = words(sentence)
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]
    if (w.toLowerCase() !== target) continue
    if (w[0] !== w[0].toUpperCase()) continue // must be capitalized in prose
    if (ambiguous && i === 0) continue
    return true
  }
  return false
}

// The way this sentence refers to `name`, as the matched surface term, or null.
// Tries the full stored name (case-insensitive), then the surname, then the first
// name (both requiring a capitalized standalone word).
function subjectMention(sentence: string, name: string): string | null {
  if (new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(sentence)) return name
  const tokens = nameTokens(name)
  const last = tokens[tokens.length - 1]
  const first = tokens[0]
  for (const tok of [last, first]) {
    if (tok && capitalizedTokenPresent(sentence, tok)) return titleCase(tok)
  }
  return null
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function hedgedRewrite(span: string, matched: string): string {
  // Cheap, mechanical hedge insertion the operator can refine. Hedges whatever
  // surface term actually matched (full name OR the surname/first name), so a
  // last-name-only mention still gets a usable rewrite.
  const re = new RegExp(`\\b${escapeRe(matched)}\\b`)
  return re.test(span) ? span.replace(re, `${matched} allegedly`) : span
}

// Every distinctive token (and full name) of every subject, lowercased — used to
// tell a KNOWN accused (handled by the subject loop) from an UNKNOWN one.
function knownNameSet(subjects: CaseSubject[]): Set<string> {
  const known = new Set<string>()
  for (const s of subjects) {
    known.add(s.name.toLowerCase())
    for (const t of nameTokens(s.name)) known.add(t.toLowerCase())
  }
  return known
}

// Given a name-shaped span captured next to a guilt verb, strip title/stopword and
// already-known tokens; whatever meaningful name remains is an unverified person.
function unknownAccused(candidate: string, known: Set<string>): string | null {
  const kept = candidate
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
    .filter((t) => {
      const lc = t.toLowerCase()
      return !NAME_STOPWORDS.has(lc) && !known.has(lc)
    })
  return kept.length ? kept.join(' ') : null
}

export function defamationLint(
  narration: string,
  subjects: CaseSubject[],
  legalStatus: LegalStatusResult[]
): DefamationFlag[] {
  const flags: DefamationFlag[] = []
  const statusByName = new Map(legalStatus.map((s) => [s.name.toLowerCase(), s]))
  const known = knownNameSet(subjects)
  const sentences = splitSentences(narration)

  for (const sentence of sentences) {
    const hasGuiltVerb = GUILT_VERBS.test(sentence)
    const hasHedge = HEDGES.test(sentence)

    // 1) Living, not-guilt-assertable named person + guilt assertion.
    for (const subj of subjects) {
      const matched = subjectMention(sentence, subj.name)
      if (!matched) continue
      const status = statusByName.get(subj.name.toLowerCase())
      const guiltAssertable = status?.guiltAssertable ?? false

      // Convicted (or historical/public-record) people CAN be named with guilt.
      if (guiltAssertable) continue
      if (!hasGuiltVerb) continue

      if (subj.living && !hasHedge) {
        flags.push({
          severity: 'block',
          span: sentence,
          subjectName: subj.name,
          reason: `Asserts guilt as fact about living, non-convicted person "${subj.name}" with no hedging. This is defamation exposure — must be hedged or removed.`,
          suggestedRewrite: hedgedRewrite(sentence, matched),
        })
      } else if (subj.living && hasHedge) {
        flags.push({
          severity: 'warn',
          span: sentence,
          subjectName: subj.name,
          reason: `Hedged guilt language about living, non-convicted "${subj.name}". Acceptable, but confirm the hedge is tied to a court record.`,
        })
      } else if (!subj.living && !hasHedge) {
        // Dead but unadjudicated — lower risk (no defamation of the dead in most
        // US jurisdictions) but still route to review for editorial accuracy.
        flags.push({
          severity: 'review',
          span: sentence,
          subjectName: subj.name,
          reason: `Asserts guilt about deceased, non-adjudicated "${subj.name}". No live defamation risk, but verify the claim and consider hedging.`,
          suggestedRewrite: hedgedRewrite(sentence, matched),
        })
      }
    }

    // 2) A person named with a guilt verb who ISN'T in the subject list at all.
    //    We never verified their legal status, so an auto agent must not publish
    //    a guilt claim about them — route to a human. Hedged sentences are safe.
    if (hasGuiltVerb && !hasHedge) {
      const seen = new Set<string>()
      for (const re of [NAME_BEFORE_GUILT, GUILT_BY_NAME]) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(sentence)) !== null) {
          const person = unknownAccused(m[1], known)
          if (!person || seen.has(person.toLowerCase())) continue
          seen.add(person.toLowerCase())
          flags.push({
            severity: 'review',
            span: sentence,
            subjectName: person,
            reason: `Names "${person}" with a guilt-asserting verb, but this person is not in the case's reviewed subject list, so their legal status was never verified. An autonomous agent must not publish an unverified guilt claim — routing to human review.`,
          })
        }
      }
    }

    // 3) "The real killer…" speculation in an unsolved case.
    if (REAL_KILLER_SPECULATION.test(sentence)) {
      flags.push({
        severity: 'review',
        span: sentence,
        reason:
          'Speculates about the true perpetrator of an unsolved case. Do not name or imply a specific living person as "the real killer" without adjudication.',
      })
    }
  }

  return flags
}
