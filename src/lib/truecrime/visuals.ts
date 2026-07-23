// Visuals stage. Sources public-domain / Creative-Commons imagery for the case
// or topic and downloads it for the slideshow render. No AI likenesses are ever
// generated here — only real, licensed archival imagery.
//
// Sourcing depth (round 9 — "starved slideshow" overhaul): the old path ran a
// SINGLE Commons search on the case name with NO quality floor, which for a
// history topic with no curated subjects yielded as few as two images — one of
// them a 6.7 KB, 250 px stock-chart thumbnail. Three fixes:
//
//   1. THREE sources, most-on-topic first —
//        • the topic's own Wikipedia article images (inherently on-topic: the
//          South Sea Bubble article carries Hogarth's engraving, the Ward
//          painting, share certificates, Microcosm-of-London plates…),
//        • a Commons search per DERIVED query (case name + subject names +
//          proper-noun phrases mined from the brief facts), not just one query,
//        • (archive.org stills still contribute upstream in the footage stage
//          where they actually return photos — pre-photography topics simply
//          have none, which is why this stage is the real workhorse for them).
//   2. A QUALITY FLOOR every candidate must clear BEFORE download — rejecting
//      tiny files (< MIN_IMAGE_BYTES), small images (long edge < MIN_IMAGE_LONG_EDGE
//      px), and junk by filename (charts, graphs, diagrams, logos, icons, seals,
//      coats of arms, .svg rasterizations, locator maps). The Wikimedia API
//      returns width/height/byte-size up front, so junk is filtered without ever
//      downloading it. The 6.7 KB Japanese chart is now impossible.
//   3. A HARD MINIMUM (enforceMinUsableImages) the orchestrator calls after the
//      footage + Wikimedia merge — fewer than MIN_USABLE_IMAGES distinct usable
//      images FAILS the run with a clear error instead of rendering a slideshow
//      of two pictures held for 30 s each.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fetchBufferBudget, fetchJsonBudget } from './budget'
import { judgeVisualCandidates, MAX_JUDGE_CANDIDATES, type JudgeCandidate, type JudgeVerdict } from './visualJudge'
import type { AssetLicense, VisualAsset } from '../compliance'
import type { CaseBrief } from './types'

const exec = promisify(execFile)

export const MEDIA_DIR = path.join(process.cwd(), 'media')
const UA = 'ContentEngine-F10/1.0 (local content tool)'
// Round 7: whole-request budgets so a stalled Commons response can never hang
// the visuals stage (same failure class as the archive.org footage hang).
const SEARCH_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 90_000
const REENCODE_TIMEOUT_MS = 20_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

// ── Quality floor ─────────────────────────────────────────────────────────

/** Minimum byte size (original file) for a usable still — anything smaller is a
 *  thumbnail, an icon, or a tiny stock chart (the 6.7 KB failure). */
export const MIN_IMAGE_BYTES = 50 * 1024
/** Minimum LONG edge (max of width/height, px) for a usable still — rejects
 *  icon/chart-sized junk while keeping legitimate portrait-orientation document
 *  scans (a tall 382 px-wide certificate still clears this on its height). */
export const MIN_IMAGE_LONG_EDGE = 600
/** Hard floor: fewer distinct usable images than this must FAIL the run rather
 *  than render a starved slideshow (owner feedback: two images over 64 s). */
export const MIN_USABLE_IMAGES = 5

/** Filename/title patterns that mark an image as data-viz or chrome rather than
 *  a real archival picture: charts, graphs, diagrams, plots, logos, icons,
 *  seals, coats of arms, locator/location maps, and .svg vector rasterizations. */
export const JUNK_TITLE_RE =
  /(chart|graph|diagram|\bplot\b|\blogo\b|\bicon\b|\bseal\b|coat[\s_-]*of[\s_-]*arms|\barms\b|locator|location[\s_-]*map|\.svg\b)/i

/** True when a filename/title looks like a chart/logo/icon/coat-of-arms/svg —
 *  never a real scene or portrait. Pure; exported for tests. */
export function isJunkImageTitle(title: string): boolean {
  return JUNK_TITLE_RE.test(title || '')
}

export interface ImageCandidateMeta {
  title: string
  width: number | null
  height: number | null
  bytes: number | null
}

/**
 * Pure accept/reject for one image candidate BEFORE download. Rejects junk
 * titles, images whose long edge is under MIN_IMAGE_LONG_EDGE, and files under
 * MIN_IMAGE_BYTES. Unknown (null) dimensions/bytes fail OPEN on that axis alone
 * — a missing measurement is not proof of junk — but a known-small value is a
 * hard reject. Exported for tests.
 */
export function isAcceptableImage(m: ImageCandidateMeta): boolean {
  if (!m.title || isJunkImageTitle(m.title)) return false
  const longEdge = Math.max(m.width ?? 0, m.height ?? 0)
  if (longEdge > 0 && longEdge < MIN_IMAGE_LONG_EDGE) return false
  if (m.bytes != null && m.bytes > 0 && m.bytes < MIN_IMAGE_BYTES) return false
  return true
}

/**
 * Hard minimum enforcement: throws a clear, owner-legible error when fewer than
 * `min` distinct usable images were sourced. The orchestrator calls this after
 * merging footage + Wikimedia imagery, so a starved topic FAILS the run instead
 * of rendering two pictures held for 30 s each. Pure; exported for tests.
 */
export function enforceMinUsableImages(count: number, topic: string, min = MIN_USABLE_IMAGES): void {
  if (count < min) {
    throw new Error(
      `only ${count} usable image${count === 1 ? '' : 's'} found for "${topic}" — ` +
        `not rendering a starved slideshow (need ≥ ${min})`
    )
  }
}

// ── AI relevance vetting (photos) ───────────────────────────────────────────

/** AI relevance judge over the ranked photo pool. Returns a keep/reject verdict
 *  per candidate (index into the passed list). Injectable for offline tests. */
export type PhotoJudge = (
  topic: string,
  angle: string,
  candidates: JudgeCandidate[],
  videoId: string
) => Promise<JudgeVerdict[]>

/** Default photo judge: the real Claude judge (keep-all fallback when keyless). */
const defaultPhotoJudge: PhotoJudge = (topic, angle, cands, videoId) =>
  judgeVisualCandidates(topic, angle, cands, 'photo', { videoId, model: 'sonnet5' })

/**
 * Partition a heuristically-ranked photo pool by the AI verdicts and pick up to
 * `maxImages`, judged-good first. If judging leaves fewer good photos than
 * `maxImages`, backfill from the unjudged remainder then the judged-rejected set
 * (best heuristic order) rather than starving the run — `usedFallback` flags
 * that this happened so the caller can log it. Candidates past the judged window
 * (index ≥ verdicts.length) are treated as unjudged. Pure; exported for tests.
 */
export function selectJudgedPhotos<T>(
  ranked: T[],
  verdicts: JudgeVerdict[],
  maxImages: number
): { chosen: T[]; usedFallback: boolean } {
  const keep = new Set(verdicts.filter((v) => v.keep).map((v) => v.index))
  const kept: T[] = []
  const unjudged: T[] = []
  const rejected: T[] = []
  ranked.forEach((c, i) => {
    if (i >= verdicts.length) unjudged.push(c)
    else if (keep.has(i)) kept.push(c)
    else rejected.push(c)
  })
  // Preference: judged-good → unjudged tail → judged-bad (all in heuristic order).
  const chosen = [...kept, ...unjudged, ...rejected].slice(0, maxImages)
  const keptUsed = Math.min(kept.length, chosen.length)
  return { chosen, usedFallback: chosen.length > keptUsed }
}

/**
 * Derive multiple Commons search queries from the brief: the case/topic name,
 * every non-minor subject name, and proper-noun phrases mined from the factual
 * bullets (key people/places/institutions — "Change Alley", "Robert Walpole",
 * "South Sea Company"). Deduped case-insensitively, case name first, capped so
 * we never fan out into dozens of calls. Pure; exported for tests.
 */
export function deriveImageQueries(brief: CaseBrief, maxQueries = 6): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (q: string | undefined) => {
    const t = (q || '').trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }

  push(brief.caseName)
  for (const s of brief.subjects) {
    if (s.isMinor) continue // minors are a hard block — never named/depicted
    push(s.name)
  }
  for (const phrase of properNounPhrases(brief.facts)) push(phrase)

  return out.slice(0, maxQueries)
}

/** Extract multi-word Capitalized phrases (proper nouns) from factual bullets,
 *  most-frequent first, dropping generic sentence-openers and stopword-only
 *  hits. Best-effort and pure. */
function properNounPhrases(facts: string[] | undefined): string[] {
  const counts = new Map<string, number>()
  const order: string[] = []
  const re = /\b[A-Z][a-z]+(?:\s+(?:(?:of|the|and|de|van|von|del|la|le)\s+)?[A-Z][a-z]+){1,3}\b/g
  for (const fact of facts ?? []) {
    for (const m of fact.matchAll(re)) {
      const phrase = m[0].replace(/\s+/g, ' ').trim()
      if (phrase.split(/\s+/).length < 2) continue
      const key = phrase.toLowerCase()
      if (!counts.has(key)) order.push(phrase)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return order.sort((a, b) => (counts.get(b.toLowerCase()) ?? 0) - (counts.get(a.toLowerCase()) ?? 0))
}

// ── Wikimedia / Wikipedia fetch layer ───────────────────────────────────────

function mapLicense(short: string | undefined): AssetLicense {
  const s = (short ?? '').toLowerCase()
  if (s.includes('public domain') || s.includes('pd-')) return 'public_domain'
  if (s.includes('cc0')) return 'cc0'
  if (s.includes('cc by') || s.includes('cc-by')) return 'cc_by'
  if (s) return 'licensed' // some other CC/attribution license — keep its ref
  return 'unknown'
}

interface ImageInfo {
  url?: string
  thumburl?: string
  width?: number
  height?: number
  size?: number
  extmetadata?: { LicenseShortName?: { value?: string }; Artist?: { value?: string } }
}
interface WikiImagePage {
  title?: string
  imageinfo?: ImageInfo[]
  images?: { title: string }[]
}
interface WikiQueryResponse {
  query?: { pages?: Record<string, WikiImagePage> }
}

/** One sourcing candidate, carrying the metadata the quality floor needs. */
interface ImageCandidate {
  title: string
  downloadUrl: string
  width: number | null
  height: number | null
  bytes: number | null
  license: AssetLicense
  artist?: string
  depictsRealPerson: boolean
  /** On-topic score (see topicTokens/relevanceScore): higher = more relevant.
   *  Demotes generic navbox/template chrome that a Wikipedia article carries
   *  (e.g. a "United States at night" satellite photo on a 1929-crash article)
   *  below the query-driven and title-matching imagery. */
  relevance: number
}

const STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'is', 'was',
  'his', 'her', 'its', 'this', 'that', 'file', 'jpg', 'jpeg', 'png', 'svg',
])

function tokenize(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** The set of on-topic tokens for a brief: case/topic name, subject names,
 *  proper-noun phrases mined from the facts, and the event year. */
export function topicTokens(brief: CaseBrief): Set<string> {
  const toks = new Set<string>()
  for (const t of tokenize(brief.caseName)) toks.add(t)
  for (const s of brief.subjects) if (!s.isMinor) for (const t of tokenize(s.name)) toks.add(t)
  for (const q of deriveImageQueries(brief)) for (const t of tokenize(q)) toks.add(t)
  if (brief.year) toks.add(String(brief.year))
  return toks
}

/** Count of DISTINCT topic tokens that appear in an image title. Pure. */
export function relevanceScore(title: string, tokens: Set<string>): number {
  const seen = new Set<string>()
  for (const t of tokenize(title.replace(/^file:/i, ''))) if (tokens.has(t) && !seen.has(t)) seen.add(t)
  return seen.size
}

const IIPROPS = 'iiprop=url|size|extmetadata&iiurlwidth=1800'

function candidateFromPage(page: WikiImagePage, depictsRealPerson: boolean): ImageCandidate | null {
  const info = page.imageinfo?.[0]
  const title = page.title ?? ''
  if (!info || !title) return null
  const url = info.url ?? ''
  // Skip non-photo media that won't render well as a still (SVG/audio/video/pdf).
  if (/\.(svg|ogg|ogv|webm|pdf|tif|tiff)$/i.test(url)) return null
  return {
    title,
    downloadUrl: info.thumburl ?? url,
    width: typeof info.width === 'number' ? info.width : null,
    height: typeof info.height === 'number' ? info.height : null,
    bytes: typeof info.size === 'number' ? info.size : null,
    license: mapLicense(info.extmetadata?.LicenseShortName?.value),
    artist: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '').slice(0, 120),
    depictsRealPerson,
    relevance: 0, // scored by the caller once the brief's topic tokens are known
  }
}

/** Commons search → candidates (with width/height/bytes for the quality floor). */
async function commonsSearchCandidates(query: string, limit: number, depictsRealPerson: boolean): Promise<ImageCandidate[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
    `&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}` +
    `&prop=imageinfo&${IIPROPS}`
  const data = (await fetchJsonBudget(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { 'User-Agent': UA } })) as
    | WikiQueryResponse
    | null
  const pages = Object.values(data?.query?.pages ?? {})
  return pages.map((p) => candidateFromPage(p, depictsRealPerson)).filter((c): c is ImageCandidate => c != null)
}

/** List the File: titles used on a Wikipedia article — inherently on-topic. */
async function articleImageTitles(articleTitle: string): Promise<string[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&imlimit=60&redirects=1&titles=' +
    encodeURIComponent(articleTitle)
  const data = (await fetchJsonBudget(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { 'User-Agent': UA } })) as
    | WikiQueryResponse
    | null
  const titles: string[] = []
  for (const page of Object.values(data?.query?.pages ?? {})) {
    for (const im of page.images ?? []) if (im.title) titles.push(im.title)
  }
  return titles
}

/** Batch imageinfo (width/height/bytes/license) for File: titles via the
 *  en.wikipedia API (it resolves Commons-hosted files transparently). */
async function imageInfoForTitles(fileTitles: string[]): Promise<ImageCandidate[]> {
  const out: ImageCandidate[] = []
  for (let i = 0; i < fileTitles.length; i += 40) {
    const chunk = fileTitles.slice(i, i + 40)
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=imageinfo' +
      `&${IIPROPS}&titles=${encodeURIComponent(chunk.join('|'))}`
    const data = (await fetchJsonBudget(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { 'User-Agent': UA } })) as
      | WikiQueryResponse
      | null
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const c = candidateFromPage(page, false)
      if (c) out.push(c)
    }
  }
  return out
}

/** Wikipedia article images, junk-title pre-filtered before the imageinfo
 *  round-trip so we don't fetch metadata for the dozens of MediaWiki chrome
 *  icons (Commons-logo.svg, edit icons, category symbols) every article carries. */
async function articleImageCandidates(brief: CaseBrief): Promise<ImageCandidate[]> {
  const article = brief.wikipediaTitle || brief.caseName
  if (!article) return []
  const titles = (await articleImageTitles(article)).filter((t) => !isJunkImageTitle(t))
  if (!titles.length) return []
  return imageInfoForTitles(titles)
}

/**
 * Discovery viability probe: how many DISTINCT usable images the topic's own
 * Wikipedia article carries — counted with EXACTLY the machinery source #1 of
 * sourceVisuals uses (prop=images list → junk-title pre-filter → imageinfo
 * quality floor → isAcceptableImage). This is the real gate that replaced the
 * obsolete archive.org-hits floor: with `archiveStillsOnly` the archive counts
 * are ~zero for every topic, but the Wikimedia article images are the workhorse
 * the render actually draws from. Article images are a conservative LOWER bound
 * (the Commons per-query search adds more at render time), so a topic clearing
 * `need` here can plausibly fill a ≥ MIN_USABLE_IMAGES slideshow. Best-effort:
 * returns 0 on any fetch error so the caller treats it as non-viable, never
 * throws. Exported for the discover stage and tests.
 */
export async function countUsableArticleImages(
  articleTitle: string,
  need = MIN_USABLE_IMAGES
): Promise<number> {
  if (!articleTitle) return 0
  try {
    const titles = (await articleImageTitles(articleTitle)).filter((t) => !isJunkImageTitle(t))
    if (!titles.length) return 0
    const candidates = await imageInfoForTitles(titles)
    let usable = 0
    for (const c of candidates) {
      if (isAcceptableImage({ title: c.title, width: c.width, height: c.height, bytes: c.bytes })) {
        usable++
        if (usable >= need) break // early-stop once viability is proven
      }
    }
    return usable
  } catch {
    return 0
  }
}

async function reencodeToBaselineJpeg(buf: Buffer, dest: string): Promise<boolean> {
  // archive.org / Commons serve stills in formats headless Chromium can't always
  // decode (progressive/CMYK JPEG, some PNGs); ffmpeg re-encodes to a baseline
  // yuvj420p JPEG so what we save, both render engines can draw. Best-effort:
  // keep the raw bytes if ffmpeg is missing or fails.
  const rawPath = `${dest}.raw`
  try {
    await writeFile(rawPath, buf)
    try {
      await exec('ffmpeg', ['-y', '-i', rawPath, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '3', dest], {
        timeout: REENCODE_TIMEOUT_MS,
      })
      if (existsSync(dest)) return true
    } catch {
      /* fall through to raw write */
    }
    await writeFile(dest, buf)
    return true
  } catch {
    return false
  } finally {
    await unlink(rawPath).catch(() => {})
  }
}

async function downloadCandidate(url: string, dest: string): Promise<boolean> {
  try {
    const buf = await fetchBufferBudget(url, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      headers: { 'User-Agent': UA },
      maxBytes: MAX_IMAGE_BYTES,
    })
    if (!buf) return false
    return await reencodeToBaselineJpeg(buf as Buffer, dest)
  } catch {
    return false
  }
}

function toAsset(c: ImageCandidate): VisualAsset {
  return {
    kind: 'image',
    source: c.downloadUrl,
    license: c.license,
    depictsRealPerson: c.depictsRealPerson,
    aiGenerated: false,
    licenseRef: c.artist,
  }
}

function licenseRank(l: AssetLicense): number {
  return { public_domain: 0, cc0: 1, cc_by: 2, licensed: 3, fair_use: 4, ai_generated: 5, unknown: 6 }[l]
}

/** Normalized key for dedup — same underlying file however it was reached
 *  (article list vs. search), ignoring the thumbnail width segment. */
function candidateKey(c: ImageCandidate): string {
  return (c.title || c.downloadUrl).toLowerCase().replace(/\s+/g, '_')
}

/**
 * Returns the sourced VisualAssets and the local file paths that downloaded
 * successfully (parallel arrays, both filtered to successes). Pulls from the
 * topic's own Wikipedia article images first (most on-topic), then a Commons
 * search per derived query, applies the quality floor to every candidate, ranks
 * public-domain first, and downloads up to `maxImages`.
 */
export async function sourceVisuals(
  videoId: string,
  brief: CaseBrief,
  maxImages = 6,
  judge: PhotoJudge = defaultPhotoJudge
): Promise<{ visuals: VisualAsset[]; imagePaths: string[] }> {
  const subjectNames = new Set(
    brief.subjects
      .filter((s) => !s.isMinor)
      .map((s) => (s.name || '').toLowerCase().trim())
      .filter(Boolean)
  )

  const tokens = topicTokens(brief)
  const collected: ImageCandidate[] = []
  const seen = new Set<string>()
  // `searchCredit` (1) marks query-driven Commons hits: they matched a topic
  // search so they're on-topic even when their filename is terse, so they
  // outrank article images that share no topic tokens (navbox/template chrome).
  const add = (c: ImageCandidate, searchCredit: number) => {
    if (!isAcceptableImage(c)) return
    const key = candidateKey(c)
    if (seen.has(key)) return
    seen.add(key)
    c.relevance = searchCredit + relevanceScore(c.title, tokens)
    collected.push(c)
  }

  // 1. The topic's own Wikipedia article images — inherently on-topic (scored on
  //    title overlap only, so template chrome with no topic tokens sinks).
  try {
    for (const c of await articleImageCandidates(brief)) add(c, 0)
  } catch {
    /* fail-soft — Commons search below still runs */
  }

  // 2. A Commons search per derived query (case name + subjects + key phrases).
  //    Over-fetch a deep pool so the quality floor + dedup + relevance ranking
  //    still leave 6+ strongly on-topic images (generic ones get outranked).
  const target = Math.max(maxImages * 3, 18)
  for (const q of deriveImageQueries(brief)) {
    if (collected.length >= target) break
    const isSubject = subjectNames.has(q.toLowerCase().trim())
    try {
      for (const c of await commonsSearchCandidates(q, 10, isSubject)) add(c, 1)
    } catch {
      /* skip this query — others still run */
    }
  }

  // Rank most-relevant first, then public-domain / CC0, then by resolution
  // (bigger = better upscale) — so generic template images sink below on-topic
  // ones.
  const sorted = collected.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      licenseRank(a.license) - licenseRank(b.license) ||
      (b.width ?? 0) - (a.width ?? 0)
  )

  // AI relevance vetting BEFORE download: reject visually-meaningless stills the
  // quality floor can't catch (book covers, autograph pages, generic objects)
  // and off-topic keyword matches. Judge the top slice, keep judged-good first,
  // and backfill heuristically if strictness would starve the >=5/>=3 floor
  // rather than failing the run. Fail-soft: keeps all on any error / no key.
  let ranked = sorted.slice(0, maxImages)
  try {
    const window = sorted.slice(0, MAX_JUDGE_CANDIDATES)
    const jc: JudgeCandidate[] = window.map((c) => ({
      title: c.title.replace(/^file:/i, ''),
      source: 'wikimedia',
    }))
    const verdicts = await judge(brief.caseName, brief.angle ?? '', jc, videoId)
    const { chosen, usedFallback } = selectJudgedPhotos(sorted, verdicts, maxImages)
    ranked = chosen
    if (usedFallback) {
      console.warn(
        `[visuals] AI judge kept fewer than ${maxImages} on-topic photos for "${brief.caseName}" — ` +
          `backfilled with best heuristic remainder to hold the floor`
      )
    }
  } catch (err) {
    console.warn(`[visuals] photo judging failed (${(err as Error)?.message ?? err}) — heuristic ordering`)
    ranked = sorted.slice(0, maxImages)
  }

  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })

  const visuals: VisualAsset[] = []
  const imagePaths: string[] = []
  let i = 0
  for (const c of ranked) {
    const dest = path.join(dir, `img-${String(i).padStart(2, '0')}.jpg`)
    if (await downloadCandidate(c.downloadUrl, dest)) {
      visuals.push(toAsset(c))
      imagePaths.push(dest)
      i++
    }
  }
  // Provenance breadcrumb: how deep the candidate pool was vs. how many stills
  // actually downloaded — makes a later starved-slideshow failure (or a transient
  // Wikimedia rate-limit window) diagnosable from the run log.
  console.log(
    `[visuals] topic="${brief.caseName}" candidates=${collected.length} downloaded=${imagePaths.length}/${ranked.length}`
  )
  return { visuals, imagePaths }
}
