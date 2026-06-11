// Defamation lint — a deterministic pass over the narration. It catches the one
// mistake that gets a true-crime channel sued: stating, as fact, that a named
// living person who has NOT been convicted committed the crime. The rule:
//
//   named living + not-guilt-assertable + guilt-asserting verb + no hedge
//     → BLOCK (this is the lawsuit sentence)
//   named living + not-guilt-assertable + guilt verb but hedged ("allegedly")
//     → WARN (acceptable, but surfaced so the operator can confirm the hedge)
//   speculation naming "the real killer" in an unsolved case
//     → REVIEW
//
// Pure logic, no API — runs even fully offline, so it's the backstop when the
// corroboration sources are unreachable.

import type { CaseSubject, DefamationFlag, LegalStatusResult } from './types'

// Verbs that assert someone committed the crime.
const GUILT_VERBS =
  /\b(murdered|killed|raped|kidnapped|abducted|assaulted|robbed|stabbed|strangled|poisoned|molested|abused|committed|perpetrated|is the killer|is the murderer|is guilty|did it|was responsible for)\b/i

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

function hedgedRewrite(span: string, name: string): string {
  // Cheap, mechanical hedge insertion the operator can refine.
  return span.replace(
    new RegExp(`\\b${name}\\b`),
    `${name} allegedly`
  )
}

export function defamationLint(
  narration: string,
  subjects: CaseSubject[],
  legalStatus: LegalStatusResult[]
): DefamationFlag[] {
  const flags: DefamationFlag[] = []
  const statusByName = new Map(legalStatus.map((s) => [s.name.toLowerCase(), s]))
  const sentences = splitSentences(narration)

  for (const sentence of sentences) {
    const hasGuiltVerb = GUILT_VERBS.test(sentence)
    const hasHedge = HEDGES.test(sentence)

    // 1) Living, not-guilt-assertable named person + guilt assertion.
    for (const subj of subjects) {
      if (!sentence.toLowerCase().includes(subj.name.toLowerCase())) continue
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
          suggestedRewrite: hedgedRewrite(sentence, subj.name),
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
          suggestedRewrite: hedgedRewrite(sentence, subj.name),
        })
      }
    }

    // 2) "The real killer…" speculation in an unsolved case.
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
