// Discover stage. Picks one curated case (rotated by day) and enriches it with
// real facts from Wikipedia (REST summary) and a Wikidata sanity-check on each
// subject's living status. Never invents subjects — the operator's curated
// metadata is the source of truth the compliance gate relies on.

import type { CaseSubject } from '../compliance'
import type { CaseBrief, CuratedCase, F10FactoryConfig } from './types'

const UA = 'ContentEngine-F10/1.0 (local content tool)'

async function safeJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

interface WikiSummary {
  title?: string
  extract?: string
  content_urls?: { desktop?: { page?: string } }
}

/** Resolve a free-text case name to a Wikipedia article title via search. */
async function resolveTitle(caseName: string): Promise<string | null> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=' +
    encodeURIComponent(caseName)
  const data = (await safeJson(url)) as
    | { query?: { search?: { title: string }[] } }
    | null
  return data?.query?.search?.[0]?.title ?? null
}

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const url =
    'https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replace(/ /g, '_'))
  return (await safeJson(url)) as WikiSummary | null
}

/** Split a summary extract into short factual bullets. */
function toFacts(extract: string): string[] {
  return extract
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, 6)
}

function extractYear(text: string): number | undefined {
  const m = text.match(/\b(18|19|20)\d{2}\b/)
  return m ? Number(m[0]) : undefined
}

/**
 * Best-effort: check Wikidata for a death date (P570) on each subject the
 * operator flagged as living. A hit means the person is dead — surface a
 * mismatch warning rather than silently trusting the operator flag.
 */
async function verifyLiving(subjects: CaseSubject[]): Promise<string[]> {
  const warnings: string[] = []
  await Promise.all(
    subjects
      .filter((s) => s.living)
      .map(async (s) => {
        const search = (await safeJson(
          'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=1&search=' +
            encodeURIComponent(s.name)
        )) as { search?: { id: string }[] } | null
        const qid = search?.search?.[0]?.id
        if (!qid) return
        const entity = (await safeJson(
          `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
        )) as { entities?: Record<string, { claims?: Record<string, unknown[]> }> } | null
        const deathClaim = entity?.entities?.[qid]?.claims?.P570
        if (deathClaim && deathClaim.length > 0) {
          warnings.push(
            `Operator flagged "${s.name}" as living, but Wikidata (${qid}) records a date of death — verify before publishing.`
          )
        }
      })
  )
  return warnings
}

function pickCase(cases: CuratedCase[]): CuratedCase {
  // Deterministic daily rotation so consecutive runs cover different cases.
  return cases[new Date().getDate() % cases.length]
}

export async function discoverCase(config: F10FactoryConfig): Promise<CaseBrief> {
  const watchlist = config.caseWatchlist ?? []
  if (watchlist.length === 0) {
    throw new Error('F10 factory has no caseWatchlist — add curated cases to the factory config.')
  }

  const chosen = pickCase(watchlist)
  const title = chosen.wikipediaTitle ?? (await resolveTitle(chosen.caseName))
  if (!title) {
    throw new Error(`Could not resolve a Wikipedia article for case "${chosen.caseName}".`)
  }

  const summary = await fetchSummary(title)
  const extract = summary?.extract ?? ''
  const livingWarnings = await verifyLiving(chosen.subjects)

  return {
    caseName: chosen.caseName,
    wikipediaTitle: summary?.title ?? title,
    wikipediaUrl:
      summary?.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    summary: extract,
    facts: toFacts(extract),
    subjects: chosen.subjects,
    year: extractYear(extract),
    angle: chosen.angle,
    livingWarnings,
  }
}
