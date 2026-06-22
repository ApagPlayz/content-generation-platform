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

/**
 * The REST summary endpoint returns only the lead sentence — too thin to build
 * a multi-beat script. The action API's `exintro` extract returns the FULL
 * intro section (several paragraphs), giving us 5–6 real factual sentences.
 */
async function fetchIntroExtract(title: string): Promise<string> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&titles=' +
    encodeURIComponent(title)
  const data = (await safeJson(url)) as
    | { query?: { pages?: Record<string, { extract?: string }> } }
    | null
  const page = data?.query?.pages ? Object.values(data.query.pages)[0] : undefined
  return page?.extract ?? ''
}

/** Remove parenthetical birth/death date ranges like "(November 19, 1904 –
 *  August 29, 1971)" — narration noise that also misleads year detection. */
function stripDateParens(text: string): string {
  return text.replace(/\s*\([^)]*\d{4}[^)]*\)/g, '').replace(/\s+/g, ' ').trim()
}

/** Split a summary extract into short factual bullets, dates cleaned. */
function toFacts(extract: string): string[] {
  return stripDateParens(extract)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, 6)
}

/** Year of the case — skip parenthetical birth/death years so we land on the
 *  event year (e.g. the crime), not a subject's birth year. */
function extractYear(text: string): number | undefined {
  const m = stripDateParens(text).match(/\b(18|19|20)\d{2}\b/)
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

  const [summary, introExtract, livingWarnings] = await Promise.all([
    fetchSummary(title),
    fetchIntroExtract(title),
    verifyLiving(chosen.subjects),
  ])
  // Prefer the fuller intro extract for facts; fall back to the lead summary.
  const leadExtract = summary?.extract ?? ''
  const extract = introExtract.length > leadExtract.length ? introExtract : leadExtract

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
