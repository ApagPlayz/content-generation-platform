// F10 True Crime — fact-checking + compliance layer.
//
// Entry point: gateVideoScript(script) runs five checks (case selection,
// ≥2-source corroboration, legal-status verification, defamation lint, visual/
// license + AI-likeness lint, and the inauthentic-content variation check),
// persists a ComplianceReport, and returns pass | route_to_review | block.
//
// Use runComplianceGate() for a dry run that does not touch the database.

export * from './types'
export { TRUE_CRIME_PROFILE, HISTORY_PROFILE, type ComplianceProfile } from './profile'
export { runComplianceGate, gateVideoScript } from './gate'
export { evaluateCaseSelection } from './caseSelection'
export { extractClaims, heuristicExtractClaims } from './claims'
export { corroborateClaims, corroboratedFraction, uncorroboratedLoadBearing } from './corroboration'
export { verifyLegalStatus } from './legalStatus'
export { defamationLint } from './defamationLint'
export { visualLint, buildDisclosurePlan } from './visualLint'
export { checkVariation } from './variation'
