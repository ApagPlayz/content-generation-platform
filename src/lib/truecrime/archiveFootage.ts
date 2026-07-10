// Archive.org footage tool for the F10 True Crime pipeline. Searches the
// archive.org Advanced Search API for public-domain/Prelinger-style footage
// matching a beat query, resolves a downloadable file via the Metadata API,
// and produces a still image (a direct download for image items, an ffmpeg
// poster-frame grab for video items) so today's still-slideshow assemble
// stage can consume it unchanged — no per-beat video stitching yet.
//
// Keyless by design (no API key needed for archive.org's public endpoints).
// Every network/ffmpeg step is wrapped to degrade to `null`, never throw, so
// a flaky connection or a missing ffmpeg binary never fails the pipeline —
// the caller (the footage/visuals resolver) just falls through to whatever
// other sources it has.
//
// License honesty: archive.org's "public domain" framing is per-item, not
// per-collection — even Prelinger films aren't uniformly PD. We only map to
// 'public_domain'/'cc0'/'cc_by' when the item's licenseurl/rights/copyright
// status explicitly say so; everything else stays 'unknown' so the
// compliance gate routes it to human review instead of assuming permissive
// use (fail-closed, never fail-open).
//
// Caching: reuses the Stage-1 StockClip helper (./stockClipCache) so a beat
// query that resolves to the same archive.org identifier is never
// re-downloaded across runs, and the same helper's beatsUsed bookkeeping
// tracks which beats a cached clip has already served.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { StockClip } from '@prisma/client'
import type { AssetLicense, VisualAsset } from '../compliance'
import { ensureStockDir, findCachedClip, parseBeatsUsed, recordStockClip, stockClipPath } from './stockClipCache'

const exec = promisify(execFile)
const UA = 'ContentEngine-F10/1.0 (local content tool; archive.org footage)'
const SOURCE = 'archive.org'

const SEARCH_TIMEOUT_MS = 15_000
const METADATA_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const POSTER_TIMEOUT_MS = 45_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15MB — stills only, never a full video download
const MAX_SEARCH_RESULTS = 5

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'mpg', 'mpeg', 'ogv']
const IMAGE_EXT = ['jpg', 'jpeg', 'png']

export interface ArchiveFootageOptions {
  /** archive.org collections to search, e.g. ['prelinger']. Default ['prelinger']. */
  collections?: string[]
  /** Beat index this footage is being sourced for; stamped onto the asset + cache row. */
  beatIndex?: number
  /** Override the conservative depictsRealPerson=true default when the caller knows better. */
  depictsRealPerson?: boolean
}

export interface ArchiveFootageResult {
  visual: VisualAsset
  /** Local still-image path (poster frame or original still) for the slideshow assemble stage. */
  localPath: string
}

interface ArchiveDoc {
  identifier?: string
  title?: string
  mediatype?: string
  licenseurl?: string
  rights?: string
  'possible-copyright-status'?: string
  collection?: string | string[]
}

interface ArchiveFile {
  name: string
  format?: string
  size?: string
}

interface ArchiveMetadata {
  files?: ArchiveFile[]
  metadata?: {
    licenseurl?: string
    rights?: string
    creator?: string
    title?: string
    'possible-copyright-status'?: string
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal, cache: 'no-store' })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function archiveSearch(query: string, collections: string[]): Promise<ArchiveDoc[]> {
  const qParts = [`(${query})`, 'mediatype:(movies OR image)']
  const collClause = collections.map((c) => c.trim()).filter(Boolean)
  if (collClause.length) qParts.push(`collection:(${collClause.join(' OR ')})`)
  const q = qParts.join(' AND ')
  const url =
    'https://archive.org/advancedsearch.php?' +
    `q=${encodeURIComponent(q)}` +
    '&fl[]=identifier&fl[]=title&fl[]=mediatype&fl[]=licenseurl&fl[]=rights' +
    '&fl[]=possible-copyright-status&fl[]=collection' +
    `&sort[]=downloads+desc&rows=${MAX_SEARCH_RESULTS}&page=1&output=json`
  try {
    const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS)
    if (!res || !res.ok) return []
    const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } }
    return data.response?.docs ?? []
  } catch {
    return []
  }
}

async function fetchItemMetadata(identifier: string): Promise<ArchiveMetadata | null> {
  try {
    const res = await fetchWithTimeout(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, METADATA_TIMEOUT_MS)
    if (!res || !res.ok) return null
    return (await res.json()) as ArchiveMetadata
  } catch {
    return null
  }
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

/** Picks the smallest suitable file of the right kind — we only need a still,
 *  never the whole reel, so smaller candidates are strictly preferable. */
function pickBestFile(meta: ArchiveMetadata, mediatype: string | undefined): ArchiveFile | null {
  const files = meta.files ?? []
  const wantVideo = mediatype !== 'image'
  const allowed = wantVideo ? VIDEO_EXT : IMAGE_EXT
  const candidates = files.filter((f) => allowed.includes(extOf(f.name)) && !/_thumb|__ia_thumb/i.test(f.name))
  if (!candidates.length) return null
  return candidates.sort((a, b) => (Number(a.size) || Infinity) - (Number(b.size) || Infinity))[0]
}

function fileUrl(identifier: string, name: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`
}

/**
 * Conservative license mapping: only 'public_domain'/'cc0'/'cc_by' when the
 * item's own metadata explicitly says so. Everything else — including bare
 * Prelinger-collection membership — stays 'unknown' so the compliance gate
 * routes it to review rather than assuming permissive use.
 */
function mapArchiveLicense(doc: ArchiveDoc, meta: ArchiveMetadata): AssetLicense {
  const licenseUrl = (doc.licenseurl || meta.metadata?.licenseurl || '').toLowerCase()
  const rights = (doc.rights || meta.metadata?.rights || '').toLowerCase()
  const copyrightStatus = (
    doc['possible-copyright-status'] ||
    meta.metadata?.['possible-copyright-status'] ||
    ''
  ).toLowerCase()

  if (licenseUrl.includes('publicdomain/zero')) return 'cc0'
  if (licenseUrl.includes('publicdomain')) return 'public_domain'
  if (copyrightStatus.replace(/\s+/g, '_').includes('not_in_copyright')) return 'public_domain'
  if (licenseUrl.includes('creativecommons.org/licenses/by/')) return 'cc_by'
  if (licenseUrl.includes('creativecommons.org')) return 'licensed'
  if (rights.includes('public domain')) return 'public_domain'
  return 'unknown'
}

function buildAttribution(doc: ArchiveDoc, meta: ArchiveMetadata): string {
  const title = doc.title || meta.metadata?.title || doc.identifier || 'archive.org item'
  const creator = meta.metadata?.creator
  const parts = [title, creator].filter(Boolean)
  return `archive.org: ${parts.join(' — ')}`.slice(0, 160)
}

let ffmpegChecked: boolean | null = null
async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked
  try {
    await exec('which', ['ffmpeg'])
    ffmpegChecked = true
  } catch {
    ffmpegChecked = false
  }
  return ffmpegChecked
}

/** Grabs a single frame straight from the remote URL (ffmpeg can seek a
 *  progressive-served file over HTTP) so we never pull down a whole reel
 *  just to make one still. Skips gracefully if ffmpeg is missing or times out. */
async function extractPosterFromUrl(url: string, destPath: string): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false
  try {
    await exec('ffmpeg', ['-y', '-ss', '2', '-i', url, '-frames:v', '1', '-q:v', '3', destPath], {
      timeout: POSTER_TIMEOUT_MS,
    })
    return existsSync(destPath)
  } catch {
    return false
  }
}

async function downloadImageFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS)
    if (!res || !res.ok) return false
    const len = Number(res.headers.get('content-length') ?? '0')
    if (len && len > MAX_IMAGE_BYTES) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) return false
    await writeFile(destPath, buf)
    return true
  } catch {
    return false
  }
}

function mergeBeats(cached: StockClip | null, beatIndex?: number): number[] | undefined {
  const existing = cached ? parseBeatsUsed(cached) : []
  if (beatIndex == null) return existing.length ? existing : undefined
  return Array.from(new Set([...existing, beatIndex]))
}

function normalizeLicense(raw: string | null): AssetLicense {
  const known: AssetLicense[] = ['public_domain', 'cc0', 'cc_by', 'fair_use', 'licensed', 'ai_generated', 'unknown']
  return (known as string[]).includes(raw ?? '') ? (raw as AssetLicense) : 'unknown'
}

function assetFromCache(cached: StockClip): VisualAsset {
  return {
    kind: 'image',
    source: `https://archive.org/details/${cached.externalId}`,
    license: normalizeLicense(cached.license),
    depictsRealPerson: true,
    aiGenerated: false,
    licenseRef: cached.attribution ?? undefined,
  }
}

/**
 * Finds and downloads a public-domain/archive.org still for a beat query,
 * caching it in StockClip so a repeat query never re-fetches. Returns null
 * on any miss (no results, network failure, ffmpeg unavailable/failed) —
 * never throws, so the caller can always fall through to another source.
 */
export async function fetchArchiveClipForBeat(
  query: string,
  opts: ArchiveFootageOptions = {}
): Promise<ArchiveFootageResult | null> {
  try {
    const collections = opts.collections?.length ? opts.collections : ['prelinger']
    const docs = await archiveSearch(query, collections)

    for (const doc of docs) {
      const identifier = doc.identifier
      if (!identifier) continue

      // 1. Cache check — reuse a prior download for this identifier if the file is still on disk.
      const cached = await findCachedClip(SOURCE, identifier)
      if (cached && existsSync(cached.localPath)) {
        const beatsUsed = mergeBeats(cached, opts.beatIndex)
        await recordStockClip({
          source: SOURCE,
          externalId: identifier,
          localPath: cached.localPath,
          width: cached.width,
          height: cached.height,
          durationSec: cached.durationSec,
          license: cached.license,
          attribution: cached.attribution,
          beatsUsed,
        })
        return { visual: assetFromCache(cached), localPath: cached.localPath }
      }

      // 2. Resolve a downloadable file from the item's metadata.
      const meta = await fetchItemMetadata(identifier)
      if (!meta) continue
      const file = pickBestFile(meta, doc.mediatype)
      if (!file) continue

      await ensureStockDir(SOURCE)
      const destPath = stockClipPath(SOURCE, identifier, 'jpg')

      const url = fileUrl(identifier, file.name)
      const posterOk = doc.mediatype === 'image' ? await downloadImageFile(url, destPath) : await extractPosterFromUrl(url, destPath)
      if (!posterOk) continue // try the next candidate rather than giving up entirely

      const license = mapArchiveLicense(doc, meta)
      const attribution = buildAttribution(doc, meta)
      const visual: VisualAsset = {
        kind: 'image',
        source: `https://archive.org/details/${identifier}`,
        license,
        depictsRealPerson: opts.depictsRealPerson ?? true,
        aiGenerated: false,
        licenseRef: attribution,
        beatIndex: opts.beatIndex,
      }

      await recordStockClip({
        source: SOURCE,
        externalId: identifier,
        localPath: destPath,
        license,
        attribution,
        beatsUsed: mergeBeats(null, opts.beatIndex),
      })

      return { visual, localPath: destPath }
    }

    return null
  } catch {
    return null
  }
}
