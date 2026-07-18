// Inauthentic-content variation check — the #1 existential risk for F10. YouTube
// demonetizes whole channels for "mass-produced… template with little to no
// variation." This compares a new script's structural signature against recent
// F10 videos and escalates if it looks like the same template stamped out again.
//
// Signature = hook pattern + section sequence + visual style + narration
// word-shingles. Similarity is the max overlap against any recent video; above
// the threshold → route to human review (who must add original analysis/variation).

import { prisma } from '../prisma'
import type { ScriptStructure, TrueCrimeScript, VariationVerdict } from './types'
import { TRUE_CRIME_PROFILE, type ComplianceProfile } from './profile'
import { shingles, jaccard } from './textSimilarity'
import { computeVisualSignature, visualRepetition } from './visualSignature'

const SIMILARITY_THRESHOLD = 0.8
// A softer bar for footage reuse — sharing most of the same images/clips with a
// recent video is a strong inauthentic-content signal the text axes can't see.
const VISUAL_REPETITION_THRESHOLD = 0.6
const RECENT_WINDOW = 15

function structuralSimilarity(a: ScriptStructure, b: ScriptStructure): number {
  let score = 0
  if (a.hookPattern === b.hookPattern) score += 0.35
  if (a.visualStyle === b.visualStyle) score += 0.25
  // Section-sequence overlap (ordered).
  const maxLen = Math.max(a.sections.length, b.sections.length) || 1
  let same = 0
  for (let i = 0; i < Math.min(a.sections.length, b.sections.length); i++) {
    if (a.sections[i] === b.sections[i]) same++
  }
  score += 0.4 * (same / maxLen)
  return score
}

interface PriorSig {
  structure?: ScriptStructure
  narration: string
  /** Rotated look/angle of the prior video (for the style-match backstop). */
  styleProfile?: { visualStyle?: string; editorialAngle?: string; hookPattern?: string }
  /** Visual-footage fingerprint id-set of the prior video. */
  visualSignature?: string[]
}

/**
 * Compare against recent F10 videos. We persist a script's structure/narration
 * inside the ComplianceReport JSON, so we read prior reports as the corpus.
 */
export async function checkVariation(
  script: TrueCrimeScript,
  profile: ComplianceProfile = TRUE_CRIME_PROFILE
): Promise<VariationVerdict> {
  const priors = await loadRecentSignatures(
    profile.factoryType,
    profile.variationWindow ?? RECENT_WINDOW
  )
  if (priors.length === 0) {
    return {
      passed: true,
      maxSimilarity: 0,
      visualSimilarity: 0,
      reasons: [`No prior ${profile.factoryType} videos to compare against.`],
    }
  }

  const myShingles = shingles(script.narration)
  const myVisual = computeVisualSignature(script.visuals ?? [])
  let maxSim = 0
  let maxVisual = 0
  const reasons: string[] = []

  for (const prior of priors) {
    const textSim = jaccard(myShingles, shingles(prior.narration))
    let structSim =
      script.structure && prior.structure
        ? structuralSimilarity(script.structure, prior.structure)
        : 0
    // Style-divergence backstop: an EXACT visualStyle+editorialAngle match against
    // a recent prior nudges the structural score up. On its own it stays under the
    // wire (the planner should have diverged); combined with high narration overlap
    // it trips. Compares both the persisted structure and the styleProfile mirror.
    const priorStyle = prior.structure?.visualStyle ?? prior.styleProfile?.visualStyle
    const priorAngle = prior.structure?.editorialAngle ?? prior.styleProfile?.editorialAngle
    if (
      script.structure?.visualStyle &&
      script.structure.visualStyle === priorStyle &&
      (script.structure.editorialAngle ?? '') === (priorAngle ?? '')
    ) {
      structSim = Math.max(structSim, 0.85)
    }
    // Weight structure and narration evenly; either alone can trip the wire.
    const combined = Math.max(textSim, 0.6 * structSim + 0.4 * textSim)
    if (combined > maxSim) maxSim = combined

    if (myVisual.length && prior.visualSignature?.length) {
      const vr = visualRepetition(myVisual, prior.visualSignature)
      if (vr > maxVisual) maxVisual = vr
    }
  }

  const textStructPass = maxSim < SIMILARITY_THRESHOLD
  const visualPass = maxVisual < VISUAL_REPETITION_THRESHOLD
  // Soft-fail either axis → route to review, never a hard block.
  const passed = textStructPass && visualPass

  if (!textStructPass) {
    reasons.push(
      `Structure/narration ${(maxSim * 100).toFixed(0)}% similar to a recent ${profile.factoryType} video — risks the ` +
        '"inauthentic content" policy. Add a unique angle, original analysis, and varied structure/visuals.'
    )
  }
  if (!visualPass) {
    reasons.push(
      `Reused ${(maxVisual * 100).toFixed(0)}% of the same footage/images as a recent video — vary the ` +
        'visuals to avoid the "inauthentic content" policy.'
    )
  }
  if (passed) {
    reasons.push(
      `Max similarity to recent videos: ${(maxSim * 100).toFixed(0)}% text/structure, ` +
        `${(maxVisual * 100).toFixed(0)}% visual (under thresholds).`
    )
  }

  return { passed, maxSimilarity: maxSim, visualSimilarity: maxVisual, reasons }
}

async function loadRecentSignatures(
  factoryType: string = 'F10',
  window: number = RECENT_WINDOW
): Promise<PriorSig[]> {
  try {
    // Same-factory rows ONLY — comparing an F11 history doc against F10 crime
    // videos (or vice versa) would poison both corpora. All pre-existing rows
    // default to 'F10', so the default keeps historical behavior.
    const rows = await prisma.complianceReport.findMany({
      where: { factoryType },
      orderBy: { createdAt: 'desc' },
      take: window,
      select: { report: true },
    })
    const sigs: PriorSig[] = []
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.report) as {
          _scriptSignature?: {
            structure?: ScriptStructure
            narration?: string
            styleProfile?: { visualStyle?: string; editorialAngle?: string; hookPattern?: string }
            visualSignature?: string[]
          }
        }
        const sig = parsed._scriptSignature
        if (sig?.narration)
          sigs.push({
            structure: sig.structure,
            narration: sig.narration,
            styleProfile: sig.styleProfile,
            visualSignature: Array.isArray(sig.visualSignature) ? sig.visualSignature : undefined,
          })
      } catch {
        // skip unparseable rows
      }
    }
    return sigs
  } catch {
    // DB not migrated yet / table missing — variation check is best-effort.
    return []
  }
}
