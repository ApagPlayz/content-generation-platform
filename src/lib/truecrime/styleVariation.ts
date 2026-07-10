// Style + editorial-angle rotator — the active defence against YouTube's
// 15-Jul-2025 "inauthentic content" policy. The script stage used to stamp a
// CONSTANT visualStyle ('beat-paced-broll') on every video, so the variation
// check always awarded the same style match and every short looked mass-produced.
// This forces each new video to DIVERGE in visual style + editorial angle from
// the last N videos of the corpus (least-recently-used pick), and it hands the
// writer a rotating commentary framing so each short carries original analysis —
// what the policy actually rewards.
//
// Pure local logic: no API calls, no keys. Best-effort DB read (returns [] on any
// error) exactly like variation.ts's loadRecentSignatures — so the feature never
// hard-fails and degrades gracefully with an empty corpus.

import { prisma } from '../prisma'

/** Named visual looks rotated across videos. Override via factory.config.styleRotation. */
export const STYLE_POOL = [
  'archival-photo-doc',
  'evidence-board',
  'map-timeline',
  'newsprint-collage',
  'courtroom-sketch',
  'surveillance-grain',
  'redacted-document',
] as const

/** Editorial/commentary framings rotated to add original analysis. Override via
 *  factory.config.editorialAngles. Every one is a NEUTRAL analytical frame — none
 *  implies guilt or a new accusation, so injecting it never trips the defamation
 *  lint or the corroboration rule. */
export const EDITORIAL_ANGLES = [
  'forensic-breakdown',
  'legal-procedure-explainer',
  'timeline-reconstruction',
  'unanswered-questions',
  'investigative-recap',
] as const

const DEFAULT_WINDOW = 5

export interface StyleProfile {
  visualStyle: string
  hookPattern: string
  editorialAngle: string
}

/** Deterministic pseudo-random fraction in [0,1) — a stable tiebreak so the same
 *  case name always resolves ties the same way (reproducible divergence). */
function hashFraction(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Pick the candidate LEAST-recently used within the recent window. `recent` is
 * most-recent-first. A candidate never seen in the window wins outright; among
 * equally-stale candidates the caseName hash breaks the tie deterministically.
 * The tie is < 1 so it can never override a real recency-rank gap.
 */
function leastRecentlyUsed(pool: string[], usedMostRecentFirst: string[], seed: string): string {
  // Clamp the effective window to the pool size — if we look back farther than
  // there are distinct styles, true divergence is impossible; fall back to
  // "as divergent as possible" rather than looping.
  const window = usedMostRecentFirst.slice(0, pool.length)
  let best = pool[0]
  let bestScore = -1
  for (const cand of pool) {
    const idx = window.indexOf(cand)
    const recencyRank = idx === -1 ? Number.MAX_SAFE_INTEGER : idx
    const score = recencyRank + hashFraction(`${seed}|${cand}`)
    if (score > bestScore) {
      bestScore = score
      best = cand
    }
  }
  return best
}

/**
 * Choose a StyleProfile that diverges from the recent window. Rotates the visual
 * style and editorial angle independently (LRU per axis). `hookPattern` is left
 * blank here — the script stage fills it from the video's actual hook so the
 * persisted signature stays honest.
 */
export function pickDivergentStyle(
  recent: StyleProfile[],
  opts: { caseName: string; pool?: string[]; angles?: string[]; window?: number }
): StyleProfile {
  const pool = opts.pool && opts.pool.length ? opts.pool : [...STYLE_POOL]
  const angles = opts.angles && opts.angles.length ? opts.angles : [...EDITORIAL_ANGLES]
  const window = Math.max(1, opts.window ?? DEFAULT_WINDOW)
  const recentWin = recent.slice(0, window)

  const visualStyle = leastRecentlyUsed(
    pool,
    recentWin.map((r) => r.visualStyle).filter(Boolean),
    `style|${opts.caseName}`
  )
  const editorialAngle = leastRecentlyUsed(
    angles,
    recentWin.map((r) => r.editorialAngle).filter(Boolean),
    `angle|${opts.caseName}`
  )
  return { visualStyle, editorialAngle, hookPattern: '' }
}

/**
 * Best-effort read of recent style profiles from the ComplianceReport corpus
 * (the same rows variation.ts reads). Parses _scriptSignature.styleProfile;
 * skips rows that predate the field. Returns [] on any error, most-recent-first.
 */
export async function loadRecentStyleProfiles(window = DEFAULT_WINDOW): Promise<StyleProfile[]> {
  // Read a little extra so rows lacking a profile don't shrink the effective window.
  const take = Math.min(Math.max(window, DEFAULT_WINDOW) * 3, 60)
  try {
    const rows = await prisma.complianceReport.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: { report: true },
    })
    const out: StyleProfile[] = []
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.report) as {
          _scriptSignature?: { styleProfile?: Partial<StyleProfile> }
        }
        const sp = parsed._scriptSignature?.styleProfile
        if (sp && (sp.visualStyle || sp.editorialAngle)) {
          out.push({
            visualStyle: String(sp.visualStyle ?? ''),
            hookPattern: String(sp.hookPattern ?? ''),
            editorialAngle: String(sp.editorialAngle ?? ''),
          })
        }
      } catch {
        // skip unparseable rows
      }
    }
    return out
  } catch {
    // DB not migrated / table missing — style rotation is best-effort.
    return []
  }
}

/** "forensic-breakdown" → "forensic breakdown" for prose injection. */
export function humanizeAngle(angle: string): string {
  return (angle || '').replace(/[-_]+/g, ' ').trim()
}
