// Stock-footage sourcing tool for the F10 per-beat footage stage. Queries
// Pexels then falls back to Pixabay for VERTICAL (portrait) video clips
// matching a beat's search query, caches the download + provider metadata in
// the StockClip table (see stockClipCache.ts), and returns compliance-typed
// VisualAsset[] the resolver/render stages can consume. Fully key-gated: with
// neither PEXELS_API_KEY nor PIXABAY_API_KEY set, every export here degrades
// to an empty/no-op result — it never throws and never blocks the run.
//
// Prisma-in-tool note: this tool touches Prisma directly (via
// stockClipCache.ts) as a sanctioned exception to the "tools don't touch
// Prisma" convention — the cross-run StockClip cache is inherently a DB
// read/write. See phase2 stock-footage-tool workstream notes.

import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import type { VisualAsset } from '../compliance'
import { ensureStockDir, findCachedClip, recordStockClip, stockClipPath } from './stockClipCache'

const UA = 'ContentEngine-F10/1.0 (local content tool)'

export type StockSource = 'pexels' | 'pixabay'

interface StockCandidate {
  source: StockSource
  externalId: string
  downloadUrl: string
  pageUrl: string
  attribution: string
  width: number
  height: number
  durationSec: number
}

export interface StockClipResult {
  beatIndex: number
  visual: VisualAsset
  localPath: string
  durationSec: number
  width: number
  height: number
}

/** True when at least one provider key is present. Read lazily (not cached)
 *  so tests/env changes within a process are picked up. */
export function stockKeysPresent(): boolean {
  return Boolean(process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY)
}

// ── Pexels ───────────────────────────────────────────────────────────────

interface PexelsVideoFile {
  quality?: string
  width?: number
  height?: number
  link?: string
}
interface PexelsVideo {
  id: number
  url: string
  duration?: number
  user?: { name?: string }
  video_files?: PexelsVideoFile[]
}
interface PexelsSearchResponse {
  videos?: PexelsVideo[]
}

async function searchPexels(query: string, perPage: number): Promise<StockCandidate[]> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []
  try {
    const url =
      'https://api.pexels.com/videos/search?' +
      `query=${encodeURIComponent(query)}&orientation=portrait&per_page=${perPage}`
    const res = await fetch(url, { headers: { Authorization: key, 'User-Agent': UA } })
    if (!res.ok) return []
    const data = (await res.json()) as PexelsSearchResponse
    const out: StockCandidate[] = []
    for (const v of data.videos ?? []) {
      const files = (v.video_files ?? []).filter((f) => f.link && f.width && f.height)
      // Prefer the tallest portrait mp4 (largest height = highest quality vertical file).
      const portrait = files.filter((f) => (f.height ?? 0) > (f.width ?? 0))
      const pick = (portrait.length ? portrait : files).sort(
        (a, b) => (b.height ?? 0) - (a.height ?? 0)
      )[0]
      if (!pick?.link || !pick.width || !pick.height) continue
      out.push({
        source: 'pexels',
        externalId: String(v.id),
        downloadUrl: pick.link,
        pageUrl: v.url,
        attribution: v.user?.name ?? 'Pexels contributor',
        width: pick.width,
        height: pick.height,
        durationSec: v.duration ?? 0,
      })
    }
    return out
  } catch {
    return []
  }
}

// ── Pixabay ──────────────────────────────────────────────────────────────

interface PixabayVideoFile {
  url?: string
  width?: number
  height?: number
}
interface PixabayHit {
  id: number
  pageURL: string
  user?: string
  duration?: number
  videos?: {
    large?: PixabayVideoFile
    medium?: PixabayVideoFile
    small?: PixabayVideoFile
    tiny?: PixabayVideoFile
  }
}
interface PixabaySearchResponse {
  hits?: PixabayHit[]
}

async function searchPixabay(query: string, perPage: number): Promise<StockCandidate[]> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []
  try {
    // Pixabay's API has no orientation filter; per_page must be >=3.
    const url =
      'https://pixabay.com/api/videos/?' +
      `key=${key}&q=${encodeURIComponent(query)}&per_page=${Math.max(3, perPage)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const data = (await res.json()) as PixabaySearchResponse
    const out: StockCandidate[] = []
    for (const hit of data.hits ?? []) {
      const files = [hit.videos?.large, hit.videos?.medium, hit.videos?.small, hit.videos?.tiny].filter(
        (f): f is PixabayVideoFile => Boolean(f?.url && f.width && f.height)
      )
      // Prefer the largest available portrait file; fall back to whatever's tallest.
      const portrait = files.filter((f) => (f.height ?? 0) > (f.width ?? 0))
      const pick = (portrait.length ? portrait : files).sort(
        (a, b) => (b.height ?? 0) - (a.height ?? 0)
      )[0]
      if (!pick?.url || !pick.width || !pick.height) continue
      out.push({
        source: 'pixabay',
        externalId: String(hit.id),
        downloadUrl: pick.url,
        pageUrl: hit.pageURL,
        attribution: hit.user ?? 'Pixabay contributor',
        width: pick.width,
        height: pick.height,
        durationSec: hit.duration ?? 0,
      })
    }
    return out
  } catch {
    return []
  }
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(dest, buf)
    return true
  } catch {
    return false
  }
}

function toAsset(c: StockCandidate): VisualAsset {
  return {
    kind: 'video',
    source: c.pageUrl,
    license: 'licensed',
    depictsRealPerson: false,
    aiGenerated: false,
    licenseRef: `${c.source} · ${c.attribution} · ${c.pageUrl}`,
  }
}

const PROVIDER_SEARCH: Record<StockSource, (query: string, perPage: number) => Promise<StockCandidate[]>> = {
  pexels: searchPexels,
  pixabay: searchPixabay,
}
const DEFAULT_PROVIDER_ORDER: StockSource[] = ['pexels', 'pixabay']

/** Resolve config.stockProviders to a valid, deduped provider order, falling
 *  back to the default (Pexels → Pixabay) when unset/empty/unrecognized. */
function resolveProviderOrder(providers?: string[]): StockSource[] {
  const order = (providers ?? [])
    .map((p) => String(p).trim().toLowerCase())
    .filter((p): p is StockSource => p === 'pexels' || p === 'pixabay')
  const deduped = Array.from(new Set(order))
  return deduped.length ? deduped : DEFAULT_PROVIDER_ORDER
}

/**
 * Resolve one beat query to a cached-or-downloaded stock clip, trying
 * providers in `providers` order (default Pexels then Pixabay). Cache-checked
 * before any network download; every failure path returns null (fail-closed
 * to "no clip"), never throws.
 */
async function fetchOneClip(
  query: string,
  exclude: Set<string>,
  providers: StockSource[] = DEFAULT_PROVIDER_ORDER
): Promise<{ candidate: StockCandidate; localPath: string } | null> {
  let candidates: StockCandidate[] = []
  try {
    for (const provider of providers) {
      candidates = await PROVIDER_SEARCH[provider](query, 5)
      if (candidates.length) break
    }
  } catch {
    return null
  }
  if (!candidates.length) return null

  for (const candidate of candidates) {
    if (exclude.has(`${candidate.source}:${candidate.externalId}`)) continue
    try {
      const cached = await findCachedClip(candidate.source, candidate.externalId)
      if (cached && existsSync(cached.localPath)) {
        return { candidate, localPath: cached.localPath }
      }

      await ensureStockDir(candidate.source)
      const dest = stockClipPath(candidate.source, candidate.externalId)
      const ok = await download(candidate.downloadUrl, dest)
      if (!ok) continue

      await recordStockClip({
        source: candidate.source,
        externalId: candidate.externalId,
        localPath: dest,
        width: candidate.width,
        height: candidate.height,
        durationSec: candidate.durationSec,
        license: 'licensed',
        attribution: candidate.attribution,
      })
      return { candidate, localPath: dest }
    } catch {
      // Try the next candidate rather than failing the whole beat.
      continue
    }
  }
  return null
}

/**
 * Query Pexels/Pixabay for each beat's search query and return the sourced
 * clips as compliance-typed VisualAssets + local paths. No-ops to
 * `{ clips: [] }` when neither provider key is present, or on any failure —
 * the caller should treat this as fully optional and fall through to the
 * existing Wikimedia image path.
 */
export async function sourceStockClips(
  videoId: string,
  queries: { beatIndex: number; query: string }[],
  maxPerBeat = 1,
  providers?: string[]
): Promise<{ clips: StockClipResult[] }> {
  if (!stockKeysPresent()) return { clips: [] }
  // videoId is accepted for API symmetry with sourceVisuals/runClipIngest and
  // future per-run diagnostics; clips themselves live in the cross-run cache.
  void videoId

  const providerOrder = resolveProviderOrder(providers)
  const clips: StockClipResult[] = []
  for (const { beatIndex, query } of queries) {
    try {
      // Loop lets maxPerBeat>1 pull additional (deduped) candidates for the
      // same beat query; stops early once the provider search is exhausted.
      const usedIds = new Set<string>()
      for (let found = 0; found < Math.max(1, maxPerBeat); found++) {
        const result = await fetchOneClip(query, usedIds, providerOrder)
        if (!result) break
        usedIds.add(`${result.candidate.source}:${result.candidate.externalId}`)
        clips.push({
          beatIndex,
          visual: { ...toAsset(result.candidate), beatIndex },
          localPath: result.localPath,
          durationSec: result.candidate.durationSec,
          width: result.candidate.width,
          height: result.candidate.height,
        })
      }
    } catch {
      // Skip this beat's clip on any unexpected error; never fail the run.
      continue
    }
  }
  return { clips }
}
