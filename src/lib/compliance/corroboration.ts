// The 2-source corroboration rule. Every load-bearing claim (charge, conviction,
// victim identity, date) must appear in ≥2 INDEPENDENT sources or the gate
// escalates to human review. Non-load-bearing colour ("the night was cold") is
// not verified. Sources are queried concurrently; a source that returns nothing
// simply doesn't count toward the two.

import type { Claim, CorroborationResult, SourceHit } from './types'
import { wikipediaCorroborate, gdeltCorroborate, courtListenerSearch } from './sources'

/** Min fuzzy confidence for a hit to count toward corroboration. */
const HIT_THRESHOLD = 0.45

function buildQuery(caseName: string, claim: Claim): string {
  // Bias the query toward the subject + case so we don't match unrelated pages.
  const parts = [caseName]
  if (claim.subjectName) parts.push(claim.subjectName)
  return parts.join(' ')
}

async function corroborateClaim(caseName: string, claim: Claim): Promise<CorroborationResult> {
  const query = buildQuery(caseName, claim)

  const [wiki, gdelt, court] = await Promise.all([
    wikipediaCorroborate(claim.text, query),
    gdeltCorroborate(claim.text, query),
    // Legal claims also lean on CourtListener as a corroboration source.
    claim.type === 'conviction' || claim.type === 'charge' || claim.type === 'acquittal'
      ? courtListenerSearch(query)
      : Promise.resolve<SourceHit[]>([]),
  ])

  const all = [...wiki, ...gdelt, ...court].filter((h) => h.confidence >= HIT_THRESHOLD)
  // Count DISTINCT sources, not distinct hits — three GDELT articles are still
  // one independent source.
  const distinctSources = new Set(all.map((h) => h.source))

  return {
    claim,
    hits: all.sort((a, b) => b.confidence - a.confidence),
    independentSourceCount: distinctSources.size,
    // Non-load-bearing claims are considered satisfied by default.
    corroborated: !claim.loadBearing || distinctSources.size >= 2,
  }
}

export async function corroborateClaims(
  caseName: string,
  claims: Claim[]
): Promise<CorroborationResult[]> {
  return Promise.all(claims.map((c) => corroborateClaim(caseName, c)))
}

/** Fraction of load-bearing claims that cleared the ≥2-source bar (0..1). */
export function corroboratedFraction(results: CorroborationResult[]): number {
  const loadBearing = results.filter((r) => r.claim.loadBearing)
  if (loadBearing.length === 0) return 1
  const ok = loadBearing.filter((r) => r.corroborated).length
  return ok / loadBearing.length
}

/** Load-bearing claims that failed — these are what force a review escalation. */
export function uncorroboratedLoadBearing(results: CorroborationResult[]): CorroborationResult[] {
  return results.filter((r) => r.claim.loadBearing && !r.corroborated)
}
