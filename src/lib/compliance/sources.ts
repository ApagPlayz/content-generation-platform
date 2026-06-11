// Free, no-key corroboration sources for the F10 fact-checker.
//   • Wikipedia  — action API, intro extracts (general corroboration)
//   • GDELT      — global news index (news corroboration)
//   • CourtListener — opinion search (legal-status verification)
// All three degrade gracefully: a network/parse failure yields [] (treated as
// "unverified"), never throws into the gate. CourtListener uses an optional
// COURTLISTENER_API_TOKEN for higher rate limits.

import type { SourceHit } from './types'

const UA = 'ContentEngine-F10-FactCheck/1.0 (local research tool)'

// ─────────────────────────── Fuzzy text matching ───────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'was',
  'were', 'is', 'are', 'be', 'been', 'by', 'with', 'as', 'that', 'this', 'it',
  'his', 'her', 'their', 'who', 'whom', 'had', 'has', 'have', 'from',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * How well a claim is supported by a passage: fraction of the claim's content
 * words that appear in the passage. Names/dates/numbers carry the most weight,
 * so we don't strip them. Returns 0..1.
 */
export function matchConfidence(claim: string, passage: string): number {
  const claimWords = tokenize(claim)
  if (claimWords.length === 0) return 0
  const passageSet = new Set(tokenize(passage))
  let hit = 0
  for (const w of claimWords) if (passageSet.has(w)) hit++
  return hit / claimWords.length
}

async function safeJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─────────────────────────── Wikipedia ───────────────────────────

interface WikiSearchResp {
  query?: { search?: { title: string; snippet: string }[] }
}
interface WikiExtractResp {
  query?: { pages?: Record<string, { title: string; extract?: string }> }
}

/** Search Wikipedia, fetch the top page's intro, score the claim against it. */
export async function wikipediaCorroborate(claim: string, query: string): Promise<SourceHit[]> {
  const searchUrl =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=' +
    encodeURIComponent(query)
  const search = (await safeJson(searchUrl)) as WikiSearchResp | null
  const top = search?.query?.search?.[0]
  if (!top) return []

  const extractUrl =
    'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&titles=' +
    encodeURIComponent(top.title)
  const ext = (await safeJson(extractUrl)) as WikiExtractResp | null
  const page = ext?.query?.pages ? Object.values(ext.query.pages)[0] : undefined
  const passage = page?.extract ?? top.snippet.replace(/<[^>]+>/g, '')
  const confidence = matchConfidence(claim, passage)
  if (confidence === 0) return []

  return [
    {
      source: 'wikipedia',
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title.replace(/ /g, '_'))}`,
      title: top.title,
      snippet: passage.slice(0, 280),
      confidence,
    },
  ]
}

// ─────────────────────────── GDELT (news) ───────────────────────────

interface GdeltResp {
  articles?: { url: string; title: string; seendate?: string; domain?: string }[]
}

/** GDELT global news index — corroborates that the case was reported on. */
export async function gdeltCorroborate(claim: string, query: string): Promise<SourceHit[]> {
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=5&query=' +
    encodeURIComponent(query)
  const data = (await safeJson(url)) as GdeltResp | null
  const articles = data?.articles ?? []
  if (articles.length === 0) return []

  // GDELT gives headlines, not bodies; match the claim against the title.
  return articles
    .map((a) => ({
      source: 'gdelt' as const,
      url: a.url,
      title: a.title,
      snippet: a.domain ? `${a.title} — ${a.domain}` : a.title,
      confidence: matchConfidence(claim, a.title),
    }))
    .filter((h) => h.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2)
}

// ─────────────────────────── CourtListener (legal) ───────────────────────────

interface ClResp {
  results?: {
    caseName?: string
    absolute_url?: string
    snippet?: string
    court?: string
    dateFiled?: string
  }[]
}

/**
 * Search CourtListener opinions for a name/case. Used both as a corroboration
 * source and (in legalStatus.ts) to read conviction/acquittal language.
 */
export async function courtListenerSearch(query: string): Promise<SourceHit[]> {
  const token = process.env.COURTLISTENER_API_TOKEN
  const url =
    'https://www.courtlistener.com/api/rest/v4/search/?type=o&order_by=score%20desc&q=' +
    encodeURIComponent(query)
  const data = (await safeJson(
    url,
    token ? { Authorization: `Token ${token}` } : {}
  )) as ClResp | null
  const results = data?.results ?? []
  if (results.length === 0) return []

  return results.slice(0, 3).map((r) => {
    const snippet = (r.snippet ?? '').replace(/<[^>]+>/g, '')
    return {
      source: 'courtlistener' as const,
      url: r.absolute_url
        ? `https://www.courtlistener.com${r.absolute_url}`
        : 'https://www.courtlistener.com',
      title: r.caseName ?? query,
      snippet: snippet.slice(0, 280) || (r.court ?? ''),
      confidence: matchConfidence(query, `${r.caseName ?? ''} ${snippet}`),
    }
  })
}
