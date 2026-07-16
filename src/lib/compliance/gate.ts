// The compliance gate — runs all five checks and returns one decision:
//
//   block            → do not produce. Any hard block (case selection, defamation
//                      'block' flag, realistic AI likeness) lands here.
//   route_to_review  → produce a draft but require a human pass before publish.
//                      Triggered by uncorroborated load-bearing claims, review/
//                      warn flags, failed variation, or selection warnings.
//   pass             → clear to proceed autonomously.
//
// Order matters: case selection runs first and short-circuits expensive network
// checks when the case is a hard block. The result is persisted (gateVideoScript)
// for legal auditability and to feed the variation corpus.
//
// The gate is shared across factories via ComplianceProfile (see profile.ts):
// the default TRUE_CRIME_PROFILE reproduces the original F10 behavior exactly;
// other profiles (e.g. F11 history/business) relax only the clearly
// crime-specific heuristics while keeping every hard safety rule.

import { prisma } from '../prisma'
import type {
  ComplianceReportJSON,
  DefamationFlag,
  GateDecision,
  TrueCrimeScript,
  VisualFlag,
} from './types'
import { TRUE_CRIME_PROFILE, type ComplianceProfile } from './profile'
import { evaluateCaseSelection } from './caseSelection'
import { extractClaims } from './claims'
import { corroborateClaims, corroboratedFraction, uncorroboratedLoadBearing } from './corroboration'
import { verifyLegalStatus } from './legalStatus'
import { defamationLint } from './defamationLint'
import { visualLint, buildDisclosurePlan } from './visualLint'
import { checkVariation } from './variation'
import { computeVisualSignature } from './visualSignature'

export async function runComplianceGate(
  script: TrueCrimeScript,
  opts: { generatedAt: string; profile?: ComplianceProfile }
): Promise<ComplianceReportJSON> {
  const profile = opts.profile ?? TRUE_CRIME_PROFILE
  const visuals = script.visuals ?? []

  // ── 1. Case selection (cheap, first, can short-circuit) ──
  const caseSelection = evaluateCaseSelection(script, profile)
  const disclosure = buildDisclosurePlan(visuals)

  if (!caseSelection.allowed) {
    return {
      caseName: script.caseName,
      decision: 'block',
      caseSelection,
      corroboration: [],
      legalStatus: [],
      defamation: [],
      visuals: visualLint(visuals),
      variation: null,
      disclosure,
      summary: `BLOCKED at case selection: ${caseSelection.hardBlocks.join(' ')}`,
      generatedAt: opts.generatedAt,
    }
  }

  // ── 2. Legal status (needed by the defamation lint) ──
  const legalStatus = await verifyLegalStatus(script.caseName, script.subjects)

  // ── 3. Claims + corroboration, defamation, visuals, variation (parallel) ──
  const subjectNames = script.subjects.map((s) => s.name)
  const claims =
    script.claims ?? (await extractClaims(script.narration, subjectNames, script.citations ?? []))

  const [corroboration, variation] = await Promise.all([
    corroborateClaims(script.caseName, claims),
    checkVariation(script, profile),
  ])
  const defamation = defamationLint(script.narration, script.subjects, legalStatus)
  const visualFlags = visualLint(visuals)

  // ── 4. Combine into a decision ──
  const failedClaims = uncorroboratedLoadBearing(corroboration)
  const decision = decideGate({
    defamation,
    visualFlags,
    failedClaimCount: failedClaims.length,
    variationPassed: variation.passed,
    caseSelectionWarnings: caseSelection.warnings.length,
    targetDurationSec: script.targetDurationSec,
    minDurationSec: profile.minDurationSec,
  })

  return {
    caseName: script.caseName,
    decision,
    caseSelection,
    corroboration,
    legalStatus,
    defamation,
    visuals: visualFlags,
    variation,
    disclosure,
    summary: buildSummary({
      decision,
      script,
      profile,
      corroboration,
      failedClaims: failedClaims.length,
      defamation,
      visualFlags,
      variation,
    }),
    generatedAt: opts.generatedAt,
  }
}

/**
 * Combine the individual check outcomes into one gate decision. Pure and
 * synchronous — no prisma, no network — so the block/review/pass precedence can
 * be unit-tested directly. Any hard block wins; otherwise any review/warn signal
 * routes to a human; otherwise the script is clear to publish autonomously.
 */
export function decideGate(input: {
  defamation: Pick<DefamationFlag, 'severity'>[]
  visualFlags: Pick<VisualFlag, 'severity'>[]
  failedClaimCount: number
  variationPassed: boolean
  caseSelectionWarnings: number
  targetDurationSec?: number
  minDurationSec: number
}): GateDecision {
  const hasBlock =
    input.defamation.some((f) => f.severity === 'block') ||
    input.visualFlags.some((f) => f.severity === 'block')
  if (hasBlock) return 'block'

  const needsReview =
    input.defamation.some((f) => f.severity === 'review' || f.severity === 'warn') ||
    input.visualFlags.some((f) => f.severity === 'review' || f.severity === 'warn') ||
    input.failedClaimCount > 0 ||
    !input.variationPassed ||
    input.caseSelectionWarnings > 0 ||
    (input.targetDurationSec !== undefined && input.targetDurationSec < input.minDurationSec)

  return needsReview ? 'route_to_review' : 'pass'
}

function buildSummary(a: {
  decision: GateDecision
  script: TrueCrimeScript
  profile: ComplianceProfile
  corroboration: ComplianceReportJSON['corroboration']
  failedClaims: number
  defamation: ComplianceReportJSON['defamation']
  visualFlags: ComplianceReportJSON['visuals']
  variation: ComplianceReportJSON['variation']
}): string {
  const pct = Math.round(corroboratedFraction(a.corroboration) * 100)
  const blocks = a.defamation.filter((f) => f.severity === 'block').length
  const vblocks = a.visualFlags.filter((f) => f.severity === 'block').length
  const parts = [
    `Decision: ${a.decision.toUpperCase()}.`,
    `${pct}% of load-bearing claims corroborated (${a.failedClaims} short of the 2-source rule).`,
  ]
  if (blocks) parts.push(`${blocks} defamation block(s).`)
  if (vblocks) parts.push(`${vblocks} prohibited visual(s).`)
  if (a.variation && !a.variation.passed) {
    const t = Math.round(a.variation.maxSimilarity * 100)
    const v = Math.round((a.variation.visualSimilarity ?? 0) * 100)
    parts.push(`Variation flagged — ${t}% text/structure, ${v}% visual overlap with recent videos.`)
  }
  if (
    a.script.targetDurationSec !== undefined &&
    a.script.targetDurationSec < a.profile.minDurationSec
  )
    parts.push(`Under ${a.profile.minDurationSec}s — earns $0 on TikTok Creator Rewards.`)
  return parts.join(' ')
}

/**
 * Run the gate AND persist a ComplianceReport row (with the script signature
 * embedded for the variation corpus). Returns the report + the row id.
 */
export async function gateVideoScript(
  script: TrueCrimeScript,
  opts: { videoId?: string; generatedAt: string; profile?: ComplianceProfile }
): Promise<{ report: ComplianceReportJSON; reportId: string }> {
  const profile = opts.profile ?? TRUE_CRIME_PROFILE
  const report = await runComplianceGate(script, { generatedAt: opts.generatedAt, profile })

  // Embed a compact signature so future variation checks can read this back —
  // narration + structure for the text/structure axes, plus the rotated style
  // profile and the visual-footage fingerprint that grow the anti-repetition corpus.
  const persisted = {
    ...report,
    _scriptSignature: {
      structure: script.structure,
      narration: script.narration,
      styleProfile: {
        visualStyle: script.structure?.visualStyle,
        hookPattern: script.structure?.hookPattern,
        editorialAngle: script.structure?.editorialAngle,
      },
      visualSignature: computeVisualSignature(script.visuals ?? []),
    },
  }

  const row = await prisma.complianceReport.create({
    data: {
      videoId: opts.videoId,
      factoryType: profile.factoryType,
      caseName: report.caseName,
      decision: report.decision,
      caseSelectionOk: report.caseSelection.allowed,
      corroboratedPct: corroboratedFraction(report.corroboration),
      defamationFlags: report.defamation.length,
      variationOk: report.variation?.passed ?? true,
      summary: report.summary,
      report: JSON.stringify(persisted),
    },
  })

  return { report, reportId: row.id }
}
