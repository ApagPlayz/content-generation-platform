// Legal-status verification. For every named ACCUSED/CONVICTED/ACQUITTED person
// we resolve whether the script may assert their guilt as fact. The author's
// declared role is the starting point; CourtListener evidence can confirm it but
// is never allowed to UPGRADE an unproven person to "guilt assertable". When in
// doubt we stay conservative (guilt not assertable) so the defamation lint and
// the gate err toward escalation.

import type { CaseSubject, LegalStatus, LegalStatusResult, SourceHit } from './types'
import { courtListenerSearch } from './sources'

const CONVICTION_RE = /\b(convicted|found guilty|pleaded guilty|guilty plea|sentenced)\b/i
const ACQUITTAL_RE = /\b(acquitted|found not guilty|exonerated|charges dropped|overturned)\b/i

function evidenceStatus(hits: SourceHit[]): LegalStatus | null {
  const blob = hits.map((h) => `${h.title} ${h.snippet}`).join(' ')
  if (ACQUITTAL_RE.test(blob)) return 'acquitted'
  if (CONVICTION_RE.test(blob)) return 'convicted'
  return null
}

async function resolveSubject(caseName: string, subject: CaseSubject): Promise<LegalStatusResult> {
  // Victims/witnesses/investigators aren't "guilt assertable" subjects at all.
  if (!['accused', 'convicted', 'acquitted'].includes(subject.role)) {
    return {
      name: subject.name,
      status: 'unknown',
      evidence: [],
      guiltAssertable: false,
      notes: `Role "${subject.role}" — not an accused party; no guilt assertion applies.`,
    }
  }

  // Deceased + clearly historical accused: treat as public-record historical.
  // (Living people always get the strict path regardless of declared role.)
  const declared: LegalStatus =
    subject.role === 'convicted'
      ? 'convicted'
      : subject.role === 'acquitted'
        ? 'acquitted'
        : 'charged_pending'

  const evidence = await courtListenerSearch(`${caseName} ${subject.name}`)
  const fromEvidence = evidenceStatus(evidence)

  // Reconcile. Evidence can CONFIRM a conviction or DOWNGRADE to acquitted, but
  // we never let a thin keyword match upgrade an "accused" person to convicted
  // unless the author also declared them convicted.
  let status: LegalStatus = declared
  let notes = `Author-declared role: ${subject.role}.`

  if (fromEvidence === 'acquitted') {
    status = 'acquitted'
    notes += ' CourtListener language indicates acquittal/exoneration — guilt NOT assertable.'
  } else if (fromEvidence === 'convicted' && declared === 'convicted') {
    status = 'convicted'
    notes += ' CourtListener language corroborates conviction.'
  } else if (fromEvidence === 'convicted' && declared !== 'convicted') {
    notes +=
      ' CourtListener mentions a conviction but author did not declare one — keeping conservative ' +
      'status pending human confirmation.'
  } else if (evidence.length === 0) {
    notes += ' No CourtListener record found — conviction unconfirmed.'
  }

  // Guilt is assertable ONLY for confirmed convictions OR clearly historical,
  // deceased, public-record cases. Acquitted/pending living people: never.
  const guiltAssertable =
    status === 'convicted' && (declared === 'convicted' || fromEvidence === 'convicted')

  return { name: subject.name, status, evidence, guiltAssertable, notes }
}

export async function verifyLegalStatus(
  caseName: string,
  subjects: CaseSubject[]
): Promise<LegalStatusResult[]> {
  const relevant = subjects.filter((s) =>
    ['accused', 'convicted', 'acquitted'].includes(s.role)
  )
  return Promise.all(relevant.map((s) => resolveSubject(caseName, s)))
}
