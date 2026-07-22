// Discover stage. Picks one curated case (rotated by day, gated on MEDIA
// RICHNESS — see pickMediaRichCandidate) and enriches it with real facts from
// Wikipedia (REST summary) and a Wikidata sanity-check on each subject's
// living status. Never invents subjects — the operator's curated metadata is
// the source of truth the compliance gate relies on.

import { countDistinctArchiveItems } from './archiveFootage'
import { fetchJsonBudget } from './budget'
import { archivePoolQueries } from './footage'
import {
  nextRotationCursor,
  orderByCoverageAndRotation,
  recentCoverage,
} from '../pipeline/coverage'
import type { CaseSubject } from '../compliance'
import type { CaseBrief, CuratedCase, F10FactoryConfig } from './types'

const UA = 'ContentEngine-F10/1.0 (local content tool)'
const WIKI_TIMEOUT_MS = 15_000

/** Whole-request budget + one retry (round 7): the media-richness gate
 *  multiplied discovery's Wikipedia/Wikidata calls, so an unbounded fetch
 *  here could hang the run exactly like the archive.org one did. */
function safeJson(url: string): Promise<unknown | null> {
  return fetchJsonBudget(url, { timeoutMs: WIKI_TIMEOUT_MS, headers: { 'User-Agent': UA } })
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

/** Default media-richness floor: a case/topic needs at least this many
 *  DISTINCT archive.org movie/image hits to be accepted at discovery.
 *  Owner-tunable per factory via config.minArchiveHits (0 disables). */
export const DEFAULT_MIN_ARCHIVE_HITS = 8

export interface MediaRichPick<T> {
  chosen: T
  /** Distinct archive hits counted for the chosen candidate (capped at the threshold). */
  hits: number
  /** False when NO candidate met the floor and we fell back to the day-pick. */
  passed: boolean
}

/**
 * Media-richness selection (round 6): starting from the daily-rotation index,
 * walk the watchlist and pick the FIRST candidate with at least `threshold`
 * distinct archive.org hits — so the factory naturally lands on
 * well-documented (newsreel-era) stories instead of an 1637/1720/1882 topic
 * with no usable era footage. threshold ≤ 0 disables the gate (plain
 * day-pick). FAIL-OPEN: when no candidate passes, the original day-pick is
 * returned with passed=false — the factory keeps producing, it just can't do
 * better than its watchlist. Generic + injectable counter so both F10 and F11
 * discovery share it and tests can fake the archive.
 */
export async function pickMediaRichCandidate<T>(
  candidates: T[],
  startIndex: number,
  threshold: number,
  countHits: (candidate: T) => Promise<number>
): Promise<MediaRichPick<T>> {
  const dayPick = candidates[startIndex % candidates.length]
  if (threshold <= 0) return { chosen: dayPick, hits: 0, passed: true }
  let dayPickHits = 0
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[(startIndex + i) % candidates.length]
    let hits = 0
    try {
      hits = await countHits(cand)
    } catch {
      hits = 0 // a flaky probe must never dead-end discovery
    }
    if (i === 0) dayPickHits = hits
    if (hits >= threshold) return { chosen: cand, hits, passed: true }
  }
  return { chosen: dayPick, hits: dayPickHits, passed: false }
}

/** Default era floor: stories set before this year predate photography and
 *  newsreels — no real era footage exists for them, whatever a word-overlap
 *  search returns ("south sea" finds tropical travelogues, not the 1720
 *  bubble). Owner-tunable per factory via config.minTopicYear (0 disables). */
export const DEFAULT_MIN_TOPIC_YEAR = 1900

/** Pure era check for an enriched brief's year: unknown years pass (we can't
 *  judge them — the media-richness count is then the only gate). */
export function passesEraFloor(year: number | undefined, minYear: number): boolean {
  if (minYear <= 0 || year == null) return true
  return year >= minYear
}

/**
 * Count an ENRICHED brief's distinct archive.org inventory with the SAME
 * topic-anchored pool queries the footage stage will later run (the brief's
 * Wikipedia-extracted year sharpens the search), era-gated first: a story
 * older than the era floor scores 0 outright — pre-photography topics can
 * only match on word overlap, never on real era footage.
 */
export function briefMediaRichness(
  brief: CaseBrief,
  config: F10FactoryConfig,
  threshold: number
): Promise<number> {
  const minYear = config.minTopicYear ?? DEFAULT_MIN_TOPIC_YEAR
  if (!passesEraFloor(brief.year, minYear)) return Promise.resolve(0)
  return countDistinctArchiveItems(archivePoolQueries(brief), {
    collections: config.archiveCollections,
    need: threshold,
  })
}

/** The Wikipedia/Wikidata enrichment for ONE curated case — extracted so the
 *  media-richness gate can enrich candidates while walking the rotation. */
async function enrichCase(chosen: CuratedCase): Promise<CaseBrief> {
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

export async function discoverCase(
  config: F10FactoryConfig,
  factoryId?: string
): Promise<CaseBrief> {
  const watchlist = config.caseWatchlist ?? []
  if (watchlist.length === 0) {
    throw new Error('F10 factory has no caseWatchlist — add curated cases to the factory config.')
  }

  // Dedup FIRST, rotation SECOND, media-richness LAST. We read what this factory
  // has already shipped (ComplianceReport ledger + recent Video titles), then
  // order the watchlist so already-covered cases fall to the back and a
  // persisted cursor advances the start point every run (kills the "same case
  // all day / 5× Wright Brothers" bug). Only THEN does the media-richness gate
  // (round 6) walk that order: each candidate is enriched (Wikipedia year +
  // facts) and must clear the era floor AND the distinct-archive-hits floor;
  // the first that does wins. Fail-open on every axis — exhausted watchlist,
  // no candidate meeting the floor, or a DB hiccup — the run always produces.
  const coverage = await recentCoverage({ factoryType: 'F10', factoryId })
  const cursor = await nextRotationCursor(factoryId ? `F10:${factoryId}` : 'F10')
  const { ordered, exhausted } = orderByCoverageAndRotation(
    watchlist,
    (c) => c.caseName,
    coverage,
    cursor
  )
  if (exhausted) {
    console.warn(
      `[discover] every F10 watchlist case was recently covered — falling back to the ` +
        `least-recently-covered case. Curate more cases to widen the rotation.`
    )
  }

  const threshold = config.minArchiveHits ?? DEFAULT_MIN_ARCHIVE_HITS
  const briefs = new Map<CuratedCase, CaseBrief>()
  const enrich = async (c: CuratedCase) => {
    const cached = briefs.get(c)
    if (cached) return cached
    const brief = await enrichCase(c)
    briefs.set(c, brief)
    return brief
  }
  // `ordered` already encodes exclusion + rotation, so walk it from index 0.
  const pick = await pickMediaRichCandidate(ordered, 0, threshold, async (c) =>
    briefMediaRichness(await enrich(c), config, threshold)
  )
  if (!pick.passed) {
    console.warn(
      `[discover] no watchlist case met the media-richness gate (minArchiveHits=${threshold}, ` +
        `minTopicYear=${config.minTopicYear ?? DEFAULT_MIN_TOPIC_YEAR}); falling back to ` +
        `"${pick.chosen.caseName}" (${pick.hits} hits). Curate better-documented, newsreel-era cases.`
    )
  }
  return enrich(pick.chosen)
}
