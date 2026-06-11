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
import { tokenize } from './sources'

const SIMILARITY_THRESHOLD = 0.8
const RECENT_WINDOW = 15

/** 4-gram word shingles for narration-level similarity. */
function shingles(text: string, n = 4): Set<string> {
  const words = tokenize(text)
  const out = new Set<string>()
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '))
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

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
}

/**
 * Compare against recent F10 videos. We persist a script's structure/narration
 * inside the ComplianceReport JSON, so we read prior reports as the corpus.
 */
export async function checkVariation(script: TrueCrimeScript): Promise<VariationVerdict> {
  const priors = await loadRecentSignatures()
  if (priors.length === 0) {
    return { passed: true, maxSimilarity: 0, reasons: ['No prior F10 videos to compare against.'] }
  }

  const myShingles = shingles(script.narration)
  let maxSim = 0
  const reasons: string[] = []

  for (const prior of priors) {
    const textSim = jaccard(myShingles, shingles(prior.narration))
    const structSim =
      script.structure && prior.structure
        ? structuralSimilarity(script.structure, prior.structure)
        : 0
    // Weight structure and narration evenly; either alone can trip the wire.
    const combined = Math.max(textSim, 0.6 * structSim + 0.4 * textSim)
    if (combined > maxSim) maxSim = combined
  }

  const passed = maxSim < SIMILARITY_THRESHOLD
  if (!passed) {
    reasons.push(
      `Structure/narration ${(maxSim * 100).toFixed(0)}% similar to a recent F10 video — risks the ` +
        '"inauthentic content" policy. Add a unique angle, original analysis, and varied structure/visuals.'
    )
  } else {
    reasons.push(`Max similarity to recent videos: ${(maxSim * 100).toFixed(0)}% (under threshold).`)
  }

  return { passed, maxSimilarity: maxSim, reasons }
}

async function loadRecentSignatures(): Promise<PriorSig[]> {
  try {
    const rows = await prisma.complianceReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: RECENT_WINDOW,
      select: { report: true },
    })
    const sigs: PriorSig[] = []
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.report) as {
          _scriptSignature?: { structure?: ScriptStructure; narration?: string }
        }
        const sig = parsed._scriptSignature
        if (sig?.narration) sigs.push({ structure: sig.structure, narration: sig.narration })
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
