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
import { checkVariation } from '../compliance/variation'
import { computeVisualSignature } from '../compliance/visualSignature'
import { SPORTS_PROFILE } from '../compliance/profile'
import type {
  AssetLicense,
  ScriptStructure,
  TrueCrimeScript,
  VariationVerdict,
  VisualAsset,
  VisualFlag,
} from '../compliance/types'
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
  /** Anti-repetition verdict vs recent F9 videos (issue #17). Present only after
   *  the async gateSportsCopyright pass; the pure evaluateCopyrightRisk omits it. */
  variation?: VariationVerdict
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
  // ── Anti-repetition inputs (issue #17) — the script's spoken/edit "shape", used
  //    only by the variation axis; evaluateCopyrightRisk ignores all of these. ──
  /** The video's opening line. */
  hook?: string
  /** SEO/caption blurb (adds text signal beyond the short hook). */
  description?: string
  /** Burned-in commentary lines — the sports "narration" text. */
  analysis?: string[]
  /** Winning hook style/angle (e.g. "bold number") — a structural divergence axis. */
  hookStyle?: string
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

/** The persistable anti-repetition signature for a sports video — the same shape
 *  the true-crime/history gate embeds, so the shared checkVariation corpus reader
 *  understands F9 rows too. */
export interface SportsScriptSignature {
  narration: string
  structure: ScriptStructure
  /** The footage id-set (one entry: the source reel) for the visual-repeat axis. */
  visuals: VisualAsset[]
  visualSignature: string[]
}

/**
 * Stable footage identity for a sports clip. The source is a single YouTube reel,
 * but its id lives in the `?v=` query — which computeVisualSignature's URL
 * normaliser strips, collapsing EVERY watch URL to one hash. So pull the video id
 * out (or fall back to the matchup) and return a query-free token, so reusing the
 * same broadcast actually trips the visual axis while distinct reels stay distinct.
 */
export function sportsFootageToken(sourceUrl: string | undefined, caseName: string): string {
  const id = sourceUrl?.match(/(?:[?&]v=|\/(?:embed|shorts)\/|youtu\.be\/)([\w-]{6,})/)?.[1]
  const key = (id ?? caseName).trim().toLowerCase().replace(/\s+/g, '-')
  return `sports-src-${key || 'unknown'}`
}

/**
 * Map a sports clip + its script into the anti-repetition signature. Pure, so it's
 * unit-testable without a DB. narration = hook + blurb + burned-in commentary; the
 * structure captures the template (hook style, source strategy, whether commentary/
 * telestration are present); the visual signature fingerprints the source reel.
 */
export function buildSportsSignature(input: CopyrightRiskInput): SportsScriptSignature {
  const narration = [input.hook, input.description, ...(input.analysis ?? [])]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ')
  const sections = [
    'hook',
    ...((input.analysis?.length ?? 0) > 0 ? ['analysis'] : []),
    ...((input.telestrationCount ?? 0) > 0 ? ['telestration'] : []),
    'cta',
  ]
  const structure: ScriptStructure = {
    hookPattern: input.hookStyle ?? 'sports-hook',
    sections,
    visualStyle: input.strategy ?? 'sports-clip',
    editorialAngle: (input.league ?? 'unknown').toLowerCase(),
  }
  const visuals: VisualAsset[] = [
    {
      kind: 'video',
      source: sportsFootageToken(input.sourceUrl, input.caseName),
      license: input.sourceLicense ?? 'unknown',
      depictsRealPerson: false,
      aiGenerated: false,
    },
  ]
  return { narration, structure, visuals, visualSignature: computeVisualSignature(visuals) }
}

/**
 * Run the copyright gate AND the anti-repetition (variation) check, then persist a
 * ComplianceReport row (factoryType F9) so the review inbox can render the verdict
 * before the video goes out. Reuses the same table/plumbing as the true-crime gate.
 *
 * The variation check (issue #17) rides along here because the copyright stage is
 * F9's pre-publish decision point. It NEVER hard-blocks — checkVariation only
 * returns pass/route — so a near-duplicate merely downgrades an otherwise-clean
 * 'pass' to review; existing block/review copyright decisions are untouched. Each
 * run also embeds its `_scriptSignature`, growing the F9 corpus for next time.
 */
export async function gateSportsCopyright(
  videoId: string,
  input: CopyrightRiskInput,
  opts: { generatedAt: string }
): Promise<SportsCopyrightVerdict> {
  const verdict = evaluateCopyrightRisk(input)

  const sig = buildSportsSignature(input)
  const variation = await checkVariation(
    {
      caseName: verdict.caseName,
      subjects: [],
      narration: sig.narration,
      structure: sig.structure,
      visuals: sig.visuals,
    } as unknown as TrueCrimeScript,
    SPORTS_PROFILE
  )
  verdict.variation = variation
  if (!variation.passed) {
    verdict.riskReasons.push(...variation.reasons)
    if (verdict.decision === 'pass') {
      // Otherwise clean → hold for review purely on the repetition risk.
      verdict.decision = 'route_to_review'
      verdict.riskLevel = 'medium'
      verdict.summary =
        'Held for your review — too similar to a recent video (inauthentic-content risk). ' +
        variation.reasons.join(' ')
    } else {
      // Already flagged/blocked by copyright — just append the repetition note.
      verdict.summary = `${verdict.summary} ${variation.reasons.join(' ')}`
    }
  }

  await prisma.complianceReport.create({
    data: {
      videoId,
      factoryType: 'F9',
      caseName: verdict.caseName,
      decision: verdict.decision,
      // Sports has no case-selection / corroboration / defamation axes; keep those
      // rollup columns at safe neutral defaults. variationOk is now real (issue #17).
      // The full sports verdict lives in `report` (kind: 'sports_copyright').
      caseSelectionOk: verdict.decision !== 'block',
      corroboratedPct: 0,
      defamationFlags: 0,
      variationOk: variation.passed,
      summary: verdict.summary,
      report: JSON.stringify({
        kind: 'sports_copyright',
        ...verdict,
        // Embed the signature so future F9 variation checks can read this back —
        // mirrors the true-crime/history gate's _scriptSignature (see gate.ts).
        _scriptSignature: {
          structure: sig.structure,
          narration: sig.narration,
          styleProfile: {
            visualStyle: sig.structure.visualStyle,
            hookPattern: sig.structure.hookPattern,
            editorialAngle: sig.structure.editorialAngle,
          },
          visualSignature: sig.visualSignature,
        },
        generatedAt: opts.generatedAt,
      }),
    },
  })

  return verdict
}
