// Compliance profiles — per-factory tuning for the shared compliance gate.
//
// The gate was built for F10 (true crime) and is being reused by F11
// (history/business mini-docs). A profile carries the factory identity (which
// scopes the variation corpus so factories don't contaminate each other's
// anti-repetition checks) and the content kind (which gates the checks that are
// crime-specific and would false-positive on non-crime stories).
//
// HARD SAFETY RULES ARE NOT PROFILE-TUNABLE. Regardless of profile, the gate
// always keeps: the minor-involving hard block, the living-non-convicted-accused
// hard block, the permanently-demonetized subject-matter block, and the
// defamation lint for living persons.

export interface ComplianceProfile {
  /** Factory identity, e.g. 'F10' | 'F11'. Persisted on ComplianceReport and
   *  used to scope the variation corpus to same-factory videos only. */
  factoryType: string
  /** Gates crime-specific checks; hard safety rules apply to every kind. */
  contentKind: 'crime' | 'history-business'
  /** Below this target duration the gate routes to review (monetization floor). */
  minDurationSec: number
  /** How many recent same-factory reports the variation check compares against.
   *  Defaults to the gate's built-in window when omitted. */
  variationWindow?: number
}

/** F10 True Crime — the original, strictest profile. Default everywhere. */
export const TRUE_CRIME_PROFILE: ComplianceProfile = {
  factoryType: 'F10',
  contentKind: 'crime',
  minDurationSec: 60,
}

/** F11 History/Business-story mini-docs. Same hard safety rules; skips only the
 *  clearly crime-specific heuristics that misfire on non-crime topics. */
export const HISTORY_PROFILE: ComplianceProfile = {
  factoryType: 'F11',
  contentKind: 'history-business',
  minDurationSec: 60,
}
