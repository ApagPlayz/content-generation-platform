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

import { prisma } from '../prisma'
import type { ComplianceReportJSON, GateDecision, TrueCrimeScript } from './types'
import { evaluateCaseSelection } from './caseSelection'
import { extractClaims } from './claims'
import { corroborateClaims, corroboratedFraction, uncorroboratedLoadBearing } from './corroboration'
import { verifyLegalStatus } from './legalStatus'
import { defamationLint } from './defamationLint'
import { visualLint, buildDisclosurePlan } from './visualLint'
import { checkVariation } from './variation'

export async function runComplianceGate(
  script: TrueCrimeScript,
  opts: { generatedAt: string }
): Promise<ComplianceReportJSON> {
  const visuals = script.visuals ?? []

  // ── 1. Case selection (cheap, first, can short-circuit) ──
  const caseSelection = evaluateCaseSelection(script)
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
    checkVariation(script),
  ])
  const defamation = defamationLint(script.narration, script.subjects, legalStatus)
  const visualFlags = visualLint(visuals)

  // ── 4. Combine into a decision ──
  const hasDefamationBlock = defamation.some((f) => f.severity === 'block')
  const hasVisualBlock = visualFlags.some((f) => f.severity === 'block')
  const failedClaims = uncorroboratedLoadBearing(corroboration)
  const needsReview =
    defamation.some((f) => f.severity === 'review' || f.severity === 'warn') ||
    visualFlags.some((f) => f.severity === 'review' || f.severity === 'warn') ||
    failedClaims.length > 0 ||
    !variation.passed ||
    caseSelection.warnings.length > 0 ||
    (script.targetDurationSec !== undefined && script.targetDurationSec < 60)

  let decision: GateDecision = 'pass'
  if (hasDefamationBlock || hasVisualBlock) decision = 'block'
  else if (needsReview) decision = 'route_to_review'

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
      corroboration,
      failedClaims: failedClaims.length,
      defamation,
      visualFlags,
      variation,
    }),
    generatedAt: opts.generatedAt,
  }
}

function buildSummary(a: {
  decision: GateDecision
  script: TrueCrimeScript
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
  if (a.variation && !a.variation.passed)
    parts.push(`Variation ${Math.round(a.variation.maxSimilarity * 100)}% — too templated.`)
  if (a.script.targetDurationSec !== undefined && a.script.targetDurationSec < 60)
    parts.push('Under 60s — earns $0 on TikTok Creator Rewards.')
  return parts.join(' ')
}

/**
 * Run the gate AND persist a ComplianceReport row (with the script signature
 * embedded for the variation corpus). Returns the report + the row id.
 */
export async function gateVideoScript(
  script: TrueCrimeScript,
  opts: { videoId?: string; generatedAt: string }
): Promise<{ report: ComplianceReportJSON; reportId: string }> {
  const report = await runComplianceGate(script, { generatedAt: opts.generatedAt })

  // Embed a compact signature so future variation checks can read this back.
  const persisted = {
    ...report,
    _scriptSignature: {
      structure: script.structure,
      narration: script.narration,
    },
  }

  const row = await prisma.complianceReport.create({
    data: {
      videoId: opts.videoId,
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
