// Case-selection guardrails — the FIRST gate, run before any expensive
// fact-checking. These encode the hard "don't even make this video" rules from
// the F10 research doc. A hard block here short-circuits the whole pipeline.

import type { CaseSelectionVerdict, TrueCrimeScript } from './types'
import { TRUE_CRIME_PROFILE, type ComplianceProfile } from './profile'

// Topics that are permanently demonetized on YouTube (Jan 2026 policy) — never
// produce these regardless of framing. These are platform-level categories, not
// crime-specific, so they apply to EVERY content kind.
const PERMANENT_DEMONETIZE =
  /\b(child (abuse|sex|porn|exploitation)|csam|minor[- ]?victim|eating disorder|child trafficking)\b/i

// Visual-plan gore heuristic. The crime profile keeps the original wide net
// (crime-scene / autopsy / body …). For history-business the crime-specific
// terms — and the very false-positive-prone \bbody\b ("governing body", "body
// of water") — are dropped, but plain gore terms stay: gore is not
// advertiser-friendly on any topic.
const GORE_VISUALS_CRIME = /\b(crime[- ]?scene|autopsy|corpse|body|blood|gore)\b/i
const GORE_VISUALS_GENERAL = /\b(corpse|blood|gore)\b/i

export function evaluateCaseSelection(
  script: TrueCrimeScript,
  profile: ComplianceProfile = TRUE_CRIME_PROFILE
): CaseSelectionVerdict {
  const hardBlocks: string[] = []
  const warnings: string[] = []

  // 1) Minors — never name or depict, victim OR perpetrator.
  const minors = script.subjects.filter((s) => s.isMinor)
  if (minors.length > 0) {
    hardBlocks.push(
      `Names/depicts minor(s): ${minors.map((m) => m.name).join(', ')}. Never identify minors (victims or perpetrators).`
    )
  }

  // 2) Permanently-demonetized subject matter in the narration.
  if (PERMANENT_DEMONETIZE.test(script.narration) || PERMANENT_DEMONETIZE.test(script.caseName)) {
    hardBlocks.push(
      'Subject matter falls under permanently-demonetized categories (child abuse / trafficking / eating disorders).'
    )
  }

  // 3) Open case with a named living accused who is NOT convicted.
  const livingUnconvictedAccused = script.subjects.filter(
    (s) => s.role === 'accused' && s.living
  )
  if (livingUnconvictedAccused.length > 0) {
    hardBlocks.push(
      `Open case names living, non-convicted accused: ${livingUnconvictedAccused
        .map((s) => s.name)
        .join(', ')}. Only convicted, historical, or fully-adjudicated cases are allowed.`
    )
  }

  // 4) Acquitted living person named — allowed but must be framed carefully.
  const livingAcquitted = script.subjects.filter((s) => s.role === 'acquitted' && s.living)
  if (livingAcquitted.length > 0) {
    warnings.push(
      `Names living acquitted person(s): ${livingAcquitted
        .map((s) => s.name)
        .join(', ')}. Allowed only with "acquitted/found not guilty" framing — verify the defamation lint passes.`
    )
  }

  // 5) Gore / violence-focal content in the visual plan.
  const goreRe = profile.contentKind === 'crime' ? GORE_VISUALS_CRIME : GORE_VISUALS_GENERAL
  const goreVisuals = (script.visuals ?? []).filter((v) => goreRe.test(v.source))
  if (goreVisuals.length > 0) {
    warnings.push(
      profile.contentKind === 'crime'
        ? `${goreVisuals.length} visual(s) appear to reference crime-scene/gore imagery — not advertiser-friendly. Replace with symbolic/PD imagery.`
        : `${goreVisuals.length} visual(s) appear to reference graphic/gore imagery — not advertiser-friendly. Replace with symbolic/PD imagery.`
    )
  }

  // 6) No subjects at all / unnamed case — likely a malformed script.
  if (script.subjects.length === 0) {
    warnings.push('No subjects declared — cannot run legal-status or defamation checks reliably.')
  }

  return {
    allowed: hardBlocks.length === 0,
    hardBlocks,
    warnings,
  }
}
