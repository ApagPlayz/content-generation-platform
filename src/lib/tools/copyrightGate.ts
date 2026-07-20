// F9 Sports — pre-publish copyright-risk gate.
//
// The single most common way faceless sports channels get TERMINATED is
// re-uploading a real broadcast highlight reel with no copyright check at all
// (leagues issue DMCA *strikes*, not just Content-ID claims — 3 in 90 days
// deletes the whole channel). Our sports pipeline downloads someone else's reel
// via yt-dlp and, until now, shipped a cropped version of it with no gate.
//
// This module closes that hole. It reuses the true-crime license lint
// (compliance/visualLint) so an unaccounted-for source clip can't be published,
// and layers sports-specific copyright heuristics on top:
//   • league claim-tolerance (NFL/UFC are strike-happy; NBA is tolerant),
//   • external background music (a top copyright-claim trigger),
//   • a TRANSFORMATION CHECKLIST (voiceover/commentary, 9:16 reframe, graphics
//     overlays, kept short) — so we lean on transformative use instead of a raw
//     re-upload.
//
// It is risk MITIGATION, not a legal guarantee (real Content-ID matching can't
// run locally). It FAILS CLOSED: anything unaccounted-for routes to human review
// before it can auto-publish, mirroring the true-crime gate.

import { prisma } from '../prisma'
import { visualLint } from '../compliance/visualLint'
import type { AssetLicense, VisualAsset, VisualFlag } from '../compliance/types'
import type { LeagueTolerance } from './leaguePolicy'
import type { SportsStrategy } from './types'

// ─────────────────────────── Verdict shape ───────────────────────────

export type CopyrightRiskLevel = 'low' | 'medium' | 'high'
export type CopyrightDecision = 'pass' | 'route_to_review' | 'block'

/** The strike-defence checklist: transformative-use signals we can measure. */
export interface TransformChecklist {
  /** Our OWN commentary/analysis burned in (not just the raw broadcast audio). */
  commentaryAdded: boolean
  /** Center-cropped to 9:16 vertical (the assemble stage always does this). */
  reframedVertical: boolean
  /** Punch-in / slow-mo / telestration / captions applied — a visible edit. */
  graphicsOverlay: boolean
  /** Clip kept short (the shorter the excerpt, the stronger fair-use leans). */
  keptShort: boolean
}

export interface SportsCopyrightVerdict {
  decision: CopyrightDecision
  riskLevel: CopyrightRiskLevel
  checklist: TransformChecklist
  /** 0..4 transformation signals present. */
  checklistScore: number
  /** True once the clip is clearly transformed (reframed + ≥3 signals). */
  checklistPassed: boolean
  /** License flags from the shared true-crime lint (unaccounted source clip). */
  licenseFlags: VisualFlag[]
  /** Plain-English reasons this video carries copyright risk. */
  riskReasons: string[]
  /** One-paragraph rollup for the review inbox. */
  summary: string
  /** Matchup / trigger label shown in the inbox. */
  caseName: string
}

export interface CopyrightRiskInput {
  caseName: string
  sourceUrl?: string
  /** License the operator accounted for; defaults to 'unknown' (fail closed). */
  sourceLicense?: AssetLicense
  /** Logged license id / attribution, required for fair_use + licensed. */
  licenseRef?: string
  strategy?: SportsStrategy
  league?: string
  leagueTolerance?: LeagueTolerance
  /** Human note from the league policy (surfaced in the inbox). */
  policyNote?: string
  /** Treatments the transform stage actually applied (punch-in, telestration…). */
  treatments?: string[]
  /** Count of our own commentary lines burned in. */
  analysisLines?: number
  /** Count of telestration spotlights burned in. */
  telestrationCount?: number
  /** True once the assemble stage produced the 9:16 crop. */
  reframedVertical?: boolean
  durationSec?: number
  /** "Kept short" ceiling in seconds (default 30). */
  shortClipMaxSec?: number
}

// Need at least this many of the 4 transformation signals to count as
// "clearly transformed" rather than a raw re-upload.
const CHECKLIST_PASS_THRESHOLD = 3
const DEFAULT_SHORT_CLIP_MAX_SEC = 30

// Treatments (from the transform stage) that count as a visible edit / graphic.
const GRAPHIC_TREATMENTS = ['punch-in', 'slow-mo-peak', 'telestration', 'commentary', 'recut']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Score a sports clip's copyright risk. Pure — no I/O — so it's unit-testable
 * and the orchestrator can persist the result separately.
 */
export function evaluateCopyrightRisk(input: CopyrightRiskInput): SportsCopyrightVerdict {
  const license: AssetLicense = input.sourceLicense ?? 'unknown'
  const treatments = input.treatments ?? []
  const shortMax = input.shortClipMaxSec ?? DEFAULT_SHORT_CLIP_MAX_SEC

  // 1) License gate — reuse the true-crime lint on the source clip itself.
  // An 'unknown' license (the default for a raw yt-dlp broadcast download)
  // produces a review flag exactly as it does on the true-crime side.
  const sourceAsset: VisualAsset = {
    kind: 'video',
    source: input.sourceUrl || 'youtube',
    license,
    depictsRealPerson: false,
    aiGenerated: false,
    licenseRef: input.licenseRef,
  }
  const licenseFlags = visualLint([sourceAsset])
  const hasLicenseBlock = licenseFlags.some((f) => f.severity === 'block')
  const licenseUnaccounted = licenseFlags.some(
    (f) => f.severity === 'review' || f.severity === 'block'
  )

  // 2) Transformation checklist — our strike defence.
  const checklist: TransformChecklist = {
    commentaryAdded: (input.analysisLines ?? 0) > 0 || treatments.includes('commentary'),
    reframedVertical: input.reframedVertical !== false,
    graphicsOverlay:
      (input.telestrationCount ?? 0) > 0 ||
      treatments.some((t) => GRAPHIC_TREATMENTS.includes(t)),
    keptShort: input.durationSec == null ? true : input.durationSec <= shortMax,
  }
  const checklistScore = Object.values(checklist).filter(Boolean).length
  // A plain cropped re-upload only earns "reframed" (1/4) — it must fail.
  const checklistPassed = checklist.reframedVertical && checklistScore >= CHECKLIST_PASS_THRESHOLD

  // 3) Collect the risk reasons.
  const tolerance = input.leagueTolerance ?? 'unknown'
  const league = (input.league ?? 'unknown').toUpperCase()
  const riskReasons: string[] = []

  if (licenseUnaccounted) {
    riskReasons.push(
      'The source clip has no logged license — it is an unlicensed broadcast download.'
    )
  }
  if (tolerance === 'block') {
    riskReasons.push(input.policyNote || `${league} is blocked by policy — do not publish.`)
  } else if (tolerance === 'flag') {
    riskReasons.push(
      input.policyNote || `${league} is rights-aggressive and issues copyright strikes readily.`
    )
  } else if (tolerance === 'unknown') {
    riskReasons.push(`League couldn't be identified — treat copyright risk as unknown.`)
  }
  if (input.strategy === 'trending_audio') {
    riskReasons.push(
      'Uses external trending audio as background music — the single biggest copyright-claim trigger.'
    )
  }
  if (!checklistPassed) {
    riskReasons.push(
      'Not clearly transformed — this reads close to a raw re-upload (needs commentary, reframing, on-screen graphics and a short excerpt).'
    )
  }

  // 4) Decision — fail closed. Block only on a hard stop; otherwise any risk
  // reason routes to human review (which already blocks auto-publish).
  let decision: CopyrightDecision = 'pass'
  if (hasLicenseBlock || tolerance === 'block') decision = 'block'
  else if (riskReasons.length > 0) decision = 'route_to_review'

  // Risk level for the inbox badge.
  let riskLevel: CopyrightRiskLevel
  if (decision === 'pass') riskLevel = 'low'
  else if (decision === 'block') riskLevel = 'high'
  else if (licenseUnaccounted || tolerance === 'flag' || input.strategy === 'trending_audio')
    riskLevel = 'high'
  else riskLevel = 'medium'

  return {
    decision,
    riskLevel,
    checklist,
    checklistScore,
    checklistPassed,
    licenseFlags,
    riskReasons,
    summary: buildSummary({ decision, riskLevel, checklistScore, riskReasons }),
    caseName: input.caseName,
  }
}

function buildSummary(a: {
  decision: CopyrightDecision
  riskLevel: CopyrightRiskLevel
  checklistScore: number
  riskReasons: string[]
}): string {
  const head =
    a.decision === 'block'
      ? 'BLOCKED — copyright risk too high to publish.'
      : a.decision === 'route_to_review'
        ? `Copyright risk: ${cap(a.riskLevel)}. Held for your review before publishing.`
        : 'Copyright checks passed — clearly transformed and license accounted for.'
  const parts = [head, `Transformation checklist ${a.checklistScore}/4.`]
  if (a.riskReasons.length > 0) parts.push(a.riskReasons.join(' '))
  return parts.join(' ')
}

/**
 * Run the copyright gate AND persist a ComplianceReport row (factoryType F9) so
 * the review inbox can render the verdict before the video goes out. Reuses the
 * same table/plumbing as the true-crime gate.
 */
export async function gateSportsCopyright(
  videoId: string,
  input: CopyrightRiskInput,
  opts: { generatedAt: string }
): Promise<SportsCopyrightVerdict> {
  const verdict = evaluateCopyrightRisk(input)

  await prisma.complianceReport.create({
    data: {
      videoId,
      factoryType: 'F9',
      caseName: verdict.caseName,
      decision: verdict.decision,
      // Sports has no case-selection / corroboration / defamation / variation
      // axes; keep the rollup columns at safe neutral defaults. The full sports
      // verdict lives in `report` (kind: 'sports_copyright').
      caseSelectionOk: verdict.decision !== 'block',
      corroboratedPct: 0,
      defamationFlags: 0,
      variationOk: true,
      summary: verdict.summary,
      report: JSON.stringify({ kind: 'sports_copyright', ...verdict, generatedAt: opts.generatedAt }),
    },
  })

  return verdict
}
