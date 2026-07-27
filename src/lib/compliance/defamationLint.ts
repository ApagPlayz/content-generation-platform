// Defamation lint — a deterministic pass over the narration. It catches the one
// mistake that gets a true-crime channel sued: stating, as fact, that a named
// living person who has NOT been convicted committed the crime. The rule:
//
//   named living + not-guilt-assertable + guilt-asserting verb + no hedge
//     → BLOCK (this is the lawsuit sentence)
//   named living + not-guilt-assertable + guilt verb but hedged ("allegedly")
//     → WARN (acceptable, but surfaced so the operator can confirm the hedge)
//   a name in ACTOR position before a guilt verb that isn't a declared subject
//     → REVIEW (nobody verified this person's legal status — never auto-publish)
//   speculation naming "the real killer" in an unsolved case
//     → REVIEW
//
// Names are matched by VARIANT, not by exact string: a subject stored as
// "John Smith" is also caught as "Smith pulled the trigger" or "John did it".
// Partial (given/surname) matching is limited to roles that can plausibly be
// accused, so widening the net doesn't start flagging the victim every time the
// narration says she was murdered.
//
// Pure logic, no API — runs even fully offline, so it's the backstop when the
// corroboration sources are unreachable.

import type { CaseSubject, DefamationFlag, LegalStatusResult, SubjectRole } from './types'

// Verbs that assert someone committed the crime, split in two. ACTIONS are
// transitive; PREDICATES are copular guilt assertions. The actor-position
// matcher below treats them differently — see ACTOR_RE.
const ACTION_VERBS =
  'murdered|killed|raped|kidnapped|abducted|assaulted|robbed|stabbed|strangled|poisoned|molested|abused|committed|perpetrated|pulled the trigger|dumped the body|shot and killed'
const PREDICATE_VERBS = 'is the killer|is the murderer|is guilty|did it|was responsible for'

const GUILT_VERBS = new RegExp(`\\b(?:${ACTION_VERBS}|${PREDICATE_VERBS})\\b`, 'i')

// Hedges that make the same sentence legally safe.
const HEDGES =
  /\b(alleged|allegedly|accused|accused of|reportedly|suspected|police say|prosecutors say|charged with|according to|claimed|purported)\b/i

// Speculation about an unnamed perpetrator in an unsolved case.
const REAL_KILLER_SPECULATION = /\b(the real (killer|murderer|perpetrator)|who really did it)\b/i

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ─────────────────────────── Name variants ───────────────────────────

/** Particles that belong WITH the surname: "Van Dyke", "de la Cruz". */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'di', 'da', 'du', 'dos', 'la', 'le',
  'den', 'der', 'ten', 'ter', 'bin', 'ibn', 'al', 'st', 'saint', 'mac', 'mc',
])
const SUFFIX = /^(jr|sr|ii|iii|iv|md|phd|esq)\.?$/i

/** Roles a guilt assertion could plausibly be ABOUT. Victims, witnesses and
 *  investigators keep exact-full-name matching only: "Reed was murdered in
 *  1998" must not start flagging the victim just because we now match "Reed".
 *  This is also what keeps a victim who shares a surname with the accused
 *  ("John Smith" / "Mary Smith") from being blocked as a suspect. */
const PARTIAL_MATCH_ROLES = new Set<SubjectRole>(['accused', 'convicted', 'acquitted', 'other'])

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-name matcher. Unicode lookarounds rather than \b, which is ASCII-only
 *  and silently never matches "José"/"Nuñez". Still refuses "Smith" inside
 *  "Smithson"; still allows the possessive "Smith's". */
function nameRegExp(text: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, flags)
}

/**
 * The ways narration may legitimately refer to a stored subject:
 * full name, surname (absorbing particles), given name.
 * "John Smith Jr." → ["John Smith Jr.", "Smith", "John"].
 * Initials and sub-3-character tokens are dropped — they carry no identifying
 * weight and generate the bulk of the false positives.
 */
export function nameVariants(fullName: string): string[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (t: string | null, minLength = 3) => {
    if (!t || t.length < minLength) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }

  // The full name is always variant 0, at any length — it is the exact string
  // the original substring check used, so this can never lose a match.
  if (parts.length) push(parts.join(' '), 1)

  const core = parts.filter((p) => !SUFFIX.test(p))
  if (core.length > 1) {
    // Surname: trailing token, walking back over particles ("Van Dyke").
    let start = core.length - 1
    while (start > 1 && PARTICLES.has(core[start - 1].toLowerCase().replace(/\.$/, ''))) start--
    push(core.slice(start).join(' '))
    // Given name, unless it's an initial ("J." says nothing).
    if (!/^\p{L}\.?$/u.test(core[0])) push(core[0])
  }
  return out
}

/** True if `sentence` refers to `token` with the reference CAPITALISED. The
 *  capital is what makes given-name matching safe: "bill", "mark", "will",
 *  "grace", "hope" are ordinary lower-case English words. */
function mentionsCapitalised(sentence: string, token: string): boolean {
  for (const m of sentence.matchAll(nameRegExp(token, 'giu'))) {
    if (/^\p{Lu}/u.test(m[0])) return true
  }
  return false
}

/** Full name (exact, case-insensitive — unchanged from the original) plus, for
 *  accusable roles, surname-only and given-name-only mentions. */
function mentionsSubject(sentence: string, subject: CaseSubject): string | null {
  const variants = nameVariants(subject.name)
  const full = variants[0]
  if (full && sentence.toLowerCase().includes(full.toLowerCase())) return full
  if (!PARTIAL_MATCH_ROLES.has(subject.role)) return null
  return variants.slice(1).find((v) => mentionsCapitalised(sentence, v)) ?? null
}

/** Insert "allegedly" after the name. Escapes the name (an unescaped, model-
 *  supplied name used to throw a SyntaxError straight out of the safety gate),
 *  falls back through the variants so a surname-only match still produces a real
 *  rewrite, and refuses to mangle a possessive into "Smith allegedly's". */
function hedgedRewrite(span: string, name: string): string {
  for (const v of nameVariants(name)) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(${escapeRegExp(v)})(?![\\p{L}\\p{N}]|['’]s)`,
      'iu'
    )
    if (re.test(span)) return span.replace(re, '$1 allegedly')
  }
  return span
}

// ─────────────────── Undeclared people in actor position ───────────────────

const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'professor', 'detective', 'det', 'officer',
  'sgt', 'sergeant', 'lt', 'lieutenant', 'capt', 'captain', 'judge', 'sheriff',
  'deputy', 'agent', 'prosecutor', 'attorney', 'rev', 'father', 'sen', 'rep', 'gov',
])

/** Capitalised words that are essentially never a person here: sentence-initial
 *  function words, the collective actors true-crime narration constantly puts in
 *  subject position, and calendar words. A noise filter, not a gazetteer. */
const NOT_A_PERSON = new Set([
  'the', 'this', 'that', 'these', 'those', 'there', 'they', 'them', 'their', 'he', 'she',
  'it', 'his', 'her', 'we', 'us', 'our', 'you', 'your', 'but', 'and', 'after', 'before',
  'when', 'while', 'then', 'later', 'instead', 'meanwhile', 'however', 'although',
  'because', 'since', 'both', 'neither', 'either', 'though', 'yet', 'still', 'next',
  'finally', 'eventually', 'according', 'many', 'most', 'some', 'several', 'one', 'two',
  'three', 'four', 'five', 'as', 'at', 'by', 'for', 'from', 'in', 'on', 'to', 'with',
  'what', 'who', 'whom', 'whose', 'why', 'how', 'where', 'which', 'someone', 'somebody',
  'nobody', 'everyone', 'anyone', 'another', 'only', 'even', 'once', 'last', 'first',
  'early', 'late', 'soon', 'within', 'over', 'under', 'during', 'despite',
  'police', 'prosecutors', 'prosecution', 'investigators', 'detectives', 'authorities',
  'officials', 'witnesses', 'jurors', 'jury', 'court', 'defense', 'defence', 'state',
  'government', 'media', 'press', 'reporters', 'neighbors', 'neighbours', 'family',
  'officers', 'deputies', 'agents', 'troopers',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'today', 'yesterday', 'tomorrow', 'tonight',
  'christmas', 'thanksgiving', 'easter',
])

/** Any of these tokens marks the whole candidate as a place or organisation. */
const PLACE_OR_ORG =
  /\b(County|City|State|Street|Avenue|Road|Drive|Lane|Boulevard|Park|River|Lake|Valley|Hospital|University|College|School|Church|Prison|Penitentiary|Department|Bureau|Police|Court|Company|Corporation|Inc|Corp|LLC|Institute|Center|Centre|Motel|Hotel|Highway|Interstate|Island|Beach|Mountain|Ranch|Township|Village|Nation|America|American)\b/

const CAP = "\\p{Lu}[\\p{L}\\p{M}'’-]+"
const PARTICLE_RE = '(?:de|del|della|da|di|du|van|von|der|den|la|le|bin|al|St\\.?)'
const NAME_SHAPE = `${CAP}(?:\\s+(?:${PARTICLE_RE}\\s+)?${CAP})*`

// ACTIVE-VOICE fillers only. The deliberate absence of was/were/is/are/been/
// being/got is what makes "Sarah was murdered" — the victim sentence, present in
// essentially every true-crime script — structurally unmatchable, instead of
// relying on a stop-word list to suppress it.
const GAP =
  '(?:\\s+(?:had|has|have|then|later|also|allegedly|reportedly|apparently|supposedly|repeatedly|brutally|violently|subsequently|finally|already|personally|deliberately))*'

// No `i` flag: the guilt verb must be lower case, so a capitalised sentence-
// initial verb can never anchor a match. `u` is required by the \p{...} classes.
const ACTOR_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${NAME_SHAPE})${GAP}\\s+(?:${ACTION_VERBS}|${PREDICATE_VERBS})(?![\\p{L}])`,
  'gu'
)

function cleanCandidate(raw: string): string | null {
  const parts = raw.split(/\s+/)
  // Strip leading honorifics ("Detective Delgado" → "Delgado") and leading
  // function/calendar words the greedy shape swallowed ("Last April Ramirez").
  while (parts.length > 0) {
    const head = parts[0].replace(/\.$/, '').toLowerCase()
    if (TITLES.has(head) || NOT_A_PERSON.has(head)) parts.shift()
    else break
  }
  if (parts.length === 0) return null
  const name = parts.join(' ')
  if (PLACE_OR_ORG.test(name)) return null
  if (parts.length === 1 && parts[0].replace(/\.$/, '').length < 3) return null
  return name
}

/** Names the sentence puts in ACTOR position directly in front of a guilt
 *  assertion — i.e. the defamatory construction, not merely a capitalised word
 *  somewhere in a sentence that happens to contain a guilt verb. */
export function actorNames(sentence: string): string[] {
  const out: string[] = []
  for (const m of sentence.matchAll(ACTOR_RE)) {
    const c = cleanCandidate(m[1])
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

// ─────────────────────────── The lint ───────────────────────────

export function defamationLint(
  narration: string,
  subjects: CaseSubject[],
  legalStatus: LegalStatusResult[],
  // Optional and defaulted so existing callers keep compiling. The case name is
  // excluded from the undeclared-person rule: "The Zodiac Killer" is a title,
  // not an unvetted suspect.
  opts: { caseName?: string } = {}
): DefamationFlag[] {
  const flags: DefamationFlag[] = []
  const statusByName = new Map(legalStatus.map((s) => [s.name.toLowerCase(), s]))
  const sentences = splitSentences(narration)

  // Every variant of every declared subject (all roles — a victim named in
  // actor position is a script bug, not an unvetted suspect), plus the words of
  // the case title, so the undeclared-person rule never re-reports them.
  const known = new Set(
    [
      ...subjects.flatMap((s) => nameVariants(s.name)),
      ...(opts.caseName ? nameVariants(opts.caseName) : []),
      ...(opts.caseName ?? '').split(/\s+/),
    ]
      .flatMap((v) => [v, ...v.split(/\s+/)])
      .map((v) => v.toLowerCase())
      .filter(Boolean)
  )

  for (const sentence of sentences) {
    const hasGuiltVerb = GUILT_VERBS.test(sentence)
    const hasHedge = HEDGES.test(sentence)

    // 1) Declared, not-guilt-assertable person + guilt assertion.
    for (const subj of subjects) {
      const matchedAs = mentionsSubject(sentence, subj)
      if (!matchedAs) continue
      const status = statusByName.get(subj.name.toLowerCase())
      const guiltAssertable = status?.guiltAssertable ?? false

      // Convicted (or historical/public-record) people CAN be named with guilt.
      if (guiltAssertable) continue
      if (!hasGuiltVerb) continue

      // How the narration referred to them, noted only when it wasn't the full
      // name — that's the case the operator can't otherwise see.
      const via =
        matchedAs.toLowerCase() === subj.name.trim().toLowerCase()
          ? ''
          : ` (named here as "${matchedAs}")`

      if (subj.living && !hasHedge) {
        flags.push({
          severity: 'block',
          span: sentence,
          subjectName: subj.name,
          reason: `Asserts guilt as fact about living, non-convicted person "${subj.name}"${via} with no hedging. This is defamation exposure — must be hedged or removed.`,
          suggestedRewrite: hedgedRewrite(sentence, subj.name),
        })
      } else if (subj.living && hasHedge) {
        flags.push({
          severity: 'warn',
          span: sentence,
          subjectName: subj.name,
          reason: `Hedged guilt language about living, non-convicted "${subj.name}"${via}. Acceptable, but confirm the hedge is tied to a court record.`,
        })
      } else if (!subj.living && !hasHedge) {
        // Dead but unadjudicated — lower risk (no defamation of the dead in most
        // US jurisdictions) but still route to review for editorial accuracy.
        flags.push({
          severity: 'review',
          span: sentence,
          subjectName: subj.name,
          reason: `Asserts guilt about deceased, non-adjudicated "${subj.name}"${via}. No live defamation risk, but verify the claim and consider hedging.`,
          suggestedRewrite: hedgedRewrite(sentence, subj.name),
        })
      }
    }

    // 2) Guilt attributed to somebody the script never declared as a subject.
    //    No subject entry means verifyLegalStatus never ran for them: we don't
    //    know if they're living, charged, convicted or acquitted. Always
    //    `review`, never `block` — this is a heuristic and must not hard-stop
    //    production, but it must never silently pass either.
    for (const actor of actorNames(sentence)) {
      const tokens = [actor, ...actor.split(/\s+/)].map((t) => t.toLowerCase())
      if (tokens.some((t) => known.has(t))) continue

      flags.push({
        severity: 'review',
        span: sentence,
        subjectName: actor,
        reason:
          `Narration attributes the crime to "${actor}", who is not in the script's subject list. ` +
          'No legal-status or living/deceased check ran for this person, so their guilt cannot be ' +
          'asserted. Declare them as a subject, or hedge/remove the attribution.' +
          (hasHedge ? ' The sentence is hedged, but their legal status is still unverified.' : ''),
        suggestedRewrite: hasHedge ? undefined : hedgedRewrite(sentence, actor),
      })
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
