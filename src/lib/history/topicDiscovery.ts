// F11 discover stage. Picks one curated history/business topic (rotated by
// day) and enriches it with real facts from Wikipedia (REST summary + full
// intro extract) plus a Wikidata sanity-check on each subject's living status.
// Mirrors src/lib/truecrime/caseDiscovery.ts — the small fetch helpers are
// re-implemented here (they are module-private in the F10 file) so F10 stays
// byte-for-byte untouched. Returns a TopicBrief that is type-identical to
// F10's CaseBrief (caseName = topicName) so the shared footage/visuals stages
// and the compliance gate keep working without adapters.
//
// Never invents subjects — the operator's curated metadata is the source of
// truth the compliance gate relies on.

import type { CaseSubject } from '../compliance'
import type { CuratedTopic, F11FactoryConfig, TopicBrief } from './types'

const UA = 'ContentEngine-F11/1.0 (local content tool)'

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

/** Resolve a free-text topic name to a Wikipedia article title via search. */
async function resolveTitle(topicName: string): Promise<string | null> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=' +
    encodeURIComponent(topicName)
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

/** Year of the story — skip parenthetical birth/death years so we land on the
 *  event year (e.g. the founding or collapse), not a subject's birth year. */
function extractYear(text: string): number | undefined {
  const m = stripDateParens(text).match(/\b(18|19|20)\d{2}\b/)
  return m ? Number(m[0]) : undefined
}

/**
 * Best-effort: check Wikidata for a death date (P570) on each subject the
 * operator flagged as living. A hit means the person is dead — surface a
 * mismatch warning rather than silently trusting the operator flag. This is
 * kept for F11 because the living-person defamation rules are hard safety
 * rules that apply regardless of factory.
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

function pickTopic(topics: CuratedTopic[]): CuratedTopic {
  // Deterministic daily rotation so consecutive runs cover different topics.
  return topics[new Date().getDate() % topics.length]
}

export async function discoverTopic(config: F11FactoryConfig): Promise<TopicBrief> {
  const watchlist = config.topicWatchlist ?? []
  if (watchlist.length === 0) {
    throw new Error('F11 factory has no topicWatchlist — add curated topics to the factory config.')
  }

  const chosen = pickTopic(watchlist)
  const title = chosen.wikipediaTitle ?? (await resolveTitle(chosen.topicName))
  if (!title) {
    throw new Error(`Could not resolve a Wikipedia article for topic "${chosen.topicName}".`)
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
    // caseName carries the topic name — the shared gate/UI key on this field.
    caseName: chosen.topicName,
    wikipediaTitle: summary?.title ?? title,
    wikipediaUrl:
      summary?.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    summary: extract,
    facts: toFacts(extract),
    subjects: chosen.subjects,
    year: extractYear(extract),
    // Fold the era into the angle so downstream framing can use it without
    // widening the shared CaseBrief shape.
    angle: chosen.angle ?? (chosen.era ? `The story of ${chosen.topicName} in the ${chosen.era}.` : undefined),
    livingWarnings,
  }
}
