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
// Junk-still gate: every still (fresh OR cached) must pass validateStillFile
// — minimum byte size, minimum decoded dimensions, and an actual ffmpeg
// decode pass — before it's returned. A file whose header parses can still
// have an undecodable body (the exact failure that crashed a Remotion render
// and dropped a whole run to the caption-less ffmpeg fallback). Poster frames
// are grabbed at a deterministic 20–70% offset into the reel (varied by beat
// index + item id, no Math.random) — never frame 0 / the first seconds, which
// on archive films are usually title cards, not scenes.
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
import { rename, stat, unlink, writeFile } from 'fs/promises'
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
const VALIDATE_TIMEOUT_MS = 20_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15MB — stills only, never a full video download
const MAX_SEARCH_RESULTS = 5

/** Minimum byte size for a usable still — anything smaller is a thumbnail or a truncated download. */
export const MIN_STILL_BYTES = 10 * 1024
/** Minimum width/height (px) for a usable still — rejects icon-sized junk. */
export const MIN_STILL_DIM = 200
/** HARD reject floor for a still's average luma (signalstats YAVG, 0–255):
 *  below this the frame is essentially a black slate (fade, leader, unexposed
 *  film) that no amount of correction saves. Frames between this and
 *  BRIGHTEN_LUMA_BELOW are kept and gamma-BRIGHTENED instead of rejected — a
 *  slightly dark era reel beats an off-topic fallback clip (round-4 evidence:
 *  healthy prelinger frames measure YAVG 54–134, so most stills touch neither
 *  bound). */
export const MIN_STILL_LUMA = 14
/** Stills measuring in [MIN_STILL_LUMA, BRIGHTEN_LUMA_BELOW) get a gamma lift
 *  toward BRIGHTEN_LUMA_TARGET rather than a rejection. Round-5 calibration
 *  against the TrueCrime composition's caption-legibility gradient (measured
 *  on a real dark still, ffmpeg-replicating the exact CSS gradient): a
 *  YAVG-34 frame drops to 24.6 on screen (bottom third near-black), while the
 *  same frame lifted to YAVG≈70 reads at ~51 post-overlay — clearly legible.
 *  Hence brighten below 40, aim for 70. */
export const BRIGHTEN_LUMA_BELOW = 40
/** Average-luma target the gamma lift aims for (phone-legible post-overlay). */
export const BRIGHTEN_LUMA_TARGET = 70

/** Flat-card junk gate (round 5): a frame whose pixels are overwhelmingly one
 *  saturated color is a slate/rating card ("PREVIEW — ALL AUDIENCES" on solid
 *  green), not a scene. Fraction of downscaled pixels that must share the
 *  dominant quantized color, and the minimum RGB spread (saturation proxy) of
 *  that color for the frame to count as a card. B/w and sepia era footage has
 *  near-zero spread, so it can never trip this gate. */
export const FLAT_CARD_DOMINANT_FRACTION = 0.55
export const FLAT_CARD_MIN_SATURATION = 60

/** Curated era-appropriate archive.org collections the per-video pool RELAXES
 *  to when the configured collections yield fewer distinct items than beats.
 *  Deliberately NOT an unscoped search — round-3 verification showed dropping
 *  the collection clause entirely pulls modern junk (a present-day police car,
 *  a music album) into a historical story. All four verified non-empty for
 *  mediatype movies/image: prelinger (ephemeral films), universal_newsreels
 *  (1929-67 newsreels), FedFlix (US gov films), flickrcommons (historical
 *  library/museum photographs — covers pre-film eras). */
export const RELAXED_ARCHIVE_COLLECTIONS = ['prelinger', 'universal_newsreels', 'FedFlix', 'flickrcommons']

// Poster frames come from a deterministic 20–70% offset into the reel — the
// opening seconds of archive films are almost always title cards, not scenes.
const POSTER_SEEK_MIN_FRACTION = 0.2
const POSTER_SEEK_MAX_FRACTION = 0.7
const FALLBACK_SEEK_SEC = 20 // duration unknown → still skip well past the titles
const RETRY_SEEK_SEC = 5 // last-resort retry offset — never frame 0

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'mpg', 'mpeg', 'ogv']
const IMAGE_EXT = ['jpg', 'jpeg', 'png']

export interface ArchiveFootageOptions {
  /** archive.org collections to search, e.g. ['prelinger']. Default ['prelinger']. */
  collections?: string[]
  /** Beat index this footage is being sourced for; stamped onto the asset + cache row. */
  beatIndex?: number
  /** Override the conservative depictsRealPerson=true default when the caller knows better. */
  depictsRealPerson?: boolean
  /** Cap on candidate clips searched/considered per call. Default MAX_SEARCH_RESULTS (5). */
  maxClips?: number
}

export interface ArchiveFootageResult {
  visual: VisualAsset
  /** Local still-image path (poster frame or original still) for the slideshow assemble stage. */
  localPath: string
}

export interface ArchiveDoc {
  identifier?: string
  title?: string
  mediatype?: string
  licenseurl?: string
  rights?: string
  'possible-copyright-status'?: string
  collection?: string | string[]
}

export interface ArchiveFile {
  name: string
  format?: string
  size?: string
  /** Duration as reported by archive.org — seconds ("571.32") or "M:SS" / "H:MM:SS". */
  length?: string
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

/** archive.org Advanced Search, scoped to movies/images (+ optional collection
 *  clause). Exported as the ArchivePoolDeps.search default and probe/test seam. */
export async function archiveSearch(query: string, collections: string[], maxResults: number): Promise<ArchiveDoc[]> {
  const qParts = [`(${query})`, 'mediatype:(movies OR image)']
  const collClause = collections.map((c) => c.trim()).filter(Boolean)
  if (collClause.length) qParts.push(`collection:(${collClause.join(' OR ')})`)
  const q = qParts.join(' AND ')
  const url =
    'https://archive.org/advancedsearch.php?' +
    `q=${encodeURIComponent(q)}` +
    '&fl[]=identifier&fl[]=title&fl[]=mediatype&fl[]=licenseurl&fl[]=rights' +
    '&fl[]=possible-copyright-status&fl[]=collection' +
    `&sort[]=downloads+desc&rows=${maxResults}&page=1&output=json`
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

/** Parse an archive.org file `length` — plain seconds ("571.32") or clock
 *  notation ("9:31", "1:02:07") — to seconds; 0 when absent/unparseable.
 *  Exported for tests. */
export function parseFileLengthSec(length: string | undefined): number {
  const s = (length ?? '').trim()
  if (!s) return 0
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^\d+(:\d{1,2})+$/.test(s)) {
    return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
  }
  return 0
}

/** Picks the best suitable file of the right kind. For VIDEO items, prefer
 *  the LONGEST file (by reported length, then larger size): items often carry
 *  a trailer/preview derivative alongside the main reel, and the old
 *  smallest-first pick landed poster grabs inside the preview — the source of
 *  a rendered MPAA rating card (round 5). The poster grab HTTP-seeks a single
 *  frame, so a longer/larger file costs nothing extra. Images keep the
 *  smallest-first pick — we only need one decodable still. */
export function pickBestFile(meta: ArchiveMetadata, mediatype: string | undefined): ArchiveFile | null {
  const files = meta.files ?? []
  const wantVideo = mediatype !== 'image'
  const allowed = wantVideo ? VIDEO_EXT : IMAGE_EXT
  const candidates = files.filter((f) => allowed.includes(extOf(f.name)) && !/_thumb|__ia_thumb/i.test(f.name))
  if (!candidates.length) return null
  if (wantVideo) {
    return candidates.sort(
      (a, b) =>
        parseFileLengthSec(b.length) - parseFileLengthSec(a.length) ||
        (Number(b.size) || 0) - (Number(a.size) || 0)
    )[0]
  }
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

/**
 * Deterministic pseudo-random seek fraction in [POSTER_SEEK_MIN_FRACTION,
 * POSTER_SEEK_MAX_FRACTION] (20–70%), varied by beat index and item seed so
 * different beats grab different frames of the same reel across runs — with
 * no Math.random, so a re-run reproduces the exact same stills. Pure.
 */
export function posterSeekFraction(beatIndex: number, seed = ''): number {
  let h = Math.imul(beatIndex + 1, 2654435761) >>> 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  }
  h = (h ^ (h >>> 15)) >>> 0
  const span = POSTER_SEEK_MAX_FRACTION - POSTER_SEEK_MIN_FRACTION
  return POSTER_SEEK_MIN_FRACTION + ((h % 1000) / 999) * span
}

export interface StillStats {
  bytes: number
  /** Decoded pixel width, or null when it could not be probed. */
  width: number | null
  /** Decoded pixel height, or null when it could not be probed. */
  height: number | null
}

/**
 * Pure accept/reject for a downloaded still's stats: rejects tiny files
 * (< MIN_STILL_BYTES) and tiny dimensions (< MIN_STILL_DIM px). Unknown (null)
 * dimensions pass — a failed probe is not proof of junk; the ffmpeg decode
 * pass in validateStillFile owns corruption detection.
 */
export function isAcceptableStill(stats: StillStats): boolean {
  if (!Number.isFinite(stats.bytes) || stats.bytes < MIN_STILL_BYTES) return false
  if (stats.width != null && stats.width < MIN_STILL_DIM) return false
  if (stats.height != null && stats.height < MIN_STILL_DIM) return false
  return true
}

/**
 * Pure accept/reject for a still's measured average luma against the HARD
 * floor. `null` (probe failed / ffmpeg absent) passes — a failed measurement
 * is not proof of a black frame, same fail-open stance as the dimension probe
 * above. Frames that pass here but sit under BRIGHTEN_LUMA_BELOW are
 * brightened downstream, not rejected.
 */
export function isBrightEnoughStill(yavg: number | null): boolean {
  if (yavg == null) return true
  return Number.isFinite(yavg) && yavg >= MIN_STILL_LUMA
}

/** Pure three-way luma policy: hard-reject near-black, gamma-brighten the
 *  dark-but-recoverable band, pass everything else (null = unmeasurable = ok). */
export function stillLumaVerdict(yavg: number | null): 'reject' | 'brighten' | 'ok' {
  if (yavg == null) return 'ok'
  if (!Number.isFinite(yavg) || yavg < MIN_STILL_LUMA) return 'reject'
  if (yavg < BRIGHTEN_LUMA_BELOW) return 'brighten'
  return 'ok'
}

/**
 * Pure gamma factor lifting a frame with average luma `yavg` toward
 * BRIGHTEN_LUMA_TARGET (ffmpeg eq: out = in^(1/gamma), so >1 brightens).
 * Solves (y/255)^(1/g) = target/255 for g, clamped to [1, 2.2] so a
 * borderline frame is lifted gently and a very dark one never turns to
 * washed-out grey noise.
 */
export function brightenGamma(yavg: number): number {
  if (!Number.isFinite(yavg) || yavg <= 0) return 1
  const g = Math.log(yavg / 255) / Math.log(BRIGHTEN_LUMA_TARGET / 255)
  return Math.min(2.2, Math.max(1, g))
}

/**
 * The shared luma gate for EVERY still that can reach imagePaths, whatever
 * tier produced it (archive poster, downloaded image, mood-bank frame):
 * measures once, hard-rejects near-black (returns false), gamma-brightens the
 * dark-but-recoverable band IN PLACE (eq=gamma → baseline-JPEG re-encode,
 * same yuvj420p contract as downloadImageFile so Chromium can always draw the
 * result), passes everything else. Brightening is best-effort — a failed lift
 * leaves the original file, which already cleared the hard floor. Exported so
 * the mood-bank/stock still extraction runs the SAME pipeline (round 5).
 */
export async function ensureLegibleStill(filePath: string): Promise<boolean> {
  const yavg = await stillLumaYAvg(filePath)
  const verdict = stillLumaVerdict(yavg)
  if (verdict === 'reject') return false
  if (verdict !== 'brighten' || yavg == null) return true
  const tmpPath = `${filePath}.bright.jpg`
  try {
    await exec(
      'ffmpeg',
      ['-y', '-i', filePath, '-frames:v', '1', '-vf', `eq=gamma=${brightenGamma(yavg).toFixed(3)}`, '-pix_fmt', 'yuvj420p', '-q:v', '3', tmpPath],
      { timeout: VALIDATE_TIMEOUT_MS }
    )
    if (existsSync(tmpPath)) await rename(tmpPath, filePath)
  } catch {
    /* keep the un-brightened original — it already passed the hard floor */
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
  return true
}

/**
 * Pure flat-card detector over raw rgb24 pixels (any small downscale, e.g.
 * 32×32): quantizes each channel to 8 levels, finds the dominant color bin,
 * and flags the frame when that single bin covers ≥ FLAT_CARD_DOMINANT_FRACTION
 * of pixels AND its average color is saturated (max−min channel spread ≥
 * FLAT_CARD_MIN_SATURATION). That is the signature of a slate/rating card —
 * one solid saturated background with a little text — and never of b/w or
 * sepia era footage (spread ≈ 0) or a real color scene (no single narrow bin
 * dominates). Malformed buffers return false (fail-open, like every probe).
 */
export function isFlatColorCard(rgb: Buffer | Uint8Array): boolean {
  const pixels = Math.floor(rgb.length / 3)
  if (pixels < 16) return false
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < pixels * 3; i += 3) {
    const r = rgb[i]
    const g = rgb[i + 1]
    const b = rgb[i + 2]
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const bin = counts.get(key)
    if (bin) {
      bin.n++
      bin.r += r
      bin.g += g
      bin.b += b
    } else {
      counts.set(key, { n: 1, r, g, b })
    }
  }
  let dominant: { n: number; r: number; g: number; b: number } | null = null
  for (const bin of counts.values()) if (!dominant || bin.n > dominant.n) dominant = bin
  if (!dominant || dominant.n / pixels < FLAT_CARD_DOMINANT_FRACTION) return false
  const avg = [dominant.r / dominant.n, dominant.g / dominant.n, dominant.b / dominant.n]
  const spread = Math.max(...avg) - Math.min(...avg)
  return spread >= FLAT_CARD_MIN_SATURATION
}

/** Downscale a still to 32×32 raw RGB and run the pure flat-card detector.
 *  False (not a card) on any probe failure — fail-open like every probe. */
async function stillIsFlatCard(filePath: string): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false
  try {
    const { stdout } = await exec(
      'ffmpeg',
      ['-v', 'error', '-i', filePath, '-frames:v', '1', '-vf', 'scale=32:32', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { timeout: VALIDATE_TIMEOUT_MS, encoding: 'buffer', maxBuffer: 1024 * 1024 }
    )
    return isFlatColorCard(stdout as unknown as Buffer)
  } catch {
    return false
  }
}

/** Measure a still's average luma (signalstats YAVG, 0–255) with one cheap
 *  single-frame ffmpeg pass; null when it can't be measured. Exported for the
 *  mood-bank gate and tests. */
export async function stillLumaYAvg(filePath: string): Promise<number | null> {
  if (!(await ffmpegAvailable())) return null
  try {
    const { stdout } = await exec(
      'ffmpeg',
      ['-v', 'error', '-i', filePath, '-vf', 'signalstats,metadata=print:file=-', '-frames:v', '1', '-f', 'null', '-'],
      { timeout: VALIDATE_TIMEOUT_MS }
    )
    const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stdout)
    if (!m) return null
    const v = Number(m[1])
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

async function probeStillDimensions(filePath: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath],
      { timeout: VALIDATE_TIMEOUT_MS }
    )
    const [w, h] = stdout.trim().split(',').map((n) => Number(n))
    return {
      width: Number.isFinite(w) && w > 0 ? w : null,
      height: Number.isFinite(h) && h > 0 ? h : null,
    }
  } catch {
    return { width: null, height: null }
  }
}

/**
 * Full junk-still gate: minimum size, minimum decoded dimensions, an actual
 * ffmpeg decode pass — a file whose header parses can still have an
 * undecodable body (the exact failure that crashed a Remotion render) — and
 * a brightness floor (near-black slates read as junk, see MIN_STILL_LUMA).
 * Fail-closed on fs errors; only the size gate applies when ffmpeg is absent
 * so keyless/no-ffmpeg machines keep working as before.
 */
async function validateStillFile(filePath: string): Promise<boolean> {
  try {
    const { size } = await stat(filePath)
    if (!isAcceptableStill({ bytes: size, width: null, height: null })) return false
    if (!(await ffmpegAvailable())) return true
    const dims = await probeStillDimensions(filePath)
    if (!isAcceptableStill({ bytes: size, width: dims.width, height: dims.height })) return false
    // Real decode pass — the only reliable corruption check.
    await exec('ffmpeg', ['-v', 'error', '-i', filePath, '-frames:v', '1', '-f', 'null', '-'], {
      timeout: VALIDATE_TIMEOUT_MS,
    })
    // Brightness floor — also purges stale near-black stills from the cache
    // path so they get re-fetched with the luma-aware poster extraction.
    if (!isBrightEnoughStill(await stillLumaYAvg(filePath))) return false
    // Flat-card gate — a bright solid-color slate/rating card is junk too.
    return !(await stillIsFlatCard(filePath))
  } catch {
    return false
  }
}

/** Best-effort duration probe over HTTP so the poster seek can be a fraction
 *  of the reel; null (unknown) falls back to a fixed post-titles offset. */
async function probeDurationSec(url: string): Promise<number | null> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url],
      { timeout: METADATA_TIMEOUT_MS }
    )
    const d = Number(stdout.trim())
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

/** Alternate seek fraction for the luma retry: shift the primary fraction by
 *  a quarter of the reel, folded back into the 20–70% window, so a fade/black
 *  section at the primary offset lands somewhere genuinely different. Pure. */
export function alternateSeekFraction(fraction: number): number {
  const shifted = fraction + 0.25
  return shifted > POSTER_SEEK_MAX_FRACTION ? fraction - 0.25 : shifted
}

/** Grabs a single frame straight from the remote URL (ffmpeg can seek a
 *  progressive-served file over HTTP) so we never pull down a whole reel just
 *  to make one still. Seeks a deterministic 20–70% offset into the reel —
 *  never frame 0 / the first seconds, which on archive films are usually
 *  title cards. Each grabbed frame is luma-checked; a near-black frame (fade,
 *  leader) retries the next offset before the item is given up on. Skips
 *  gracefully if ffmpeg is missing or times out. */
async function extractPosterFromUrl(url: string, destPath: string, beatIndex = 0, seed = ''): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false
  const duration = await probeDurationSec(url)
  const fraction = posterSeekFraction(beatIndex, seed)
  const clampSeek = (sec: number) =>
    duration != null ? Math.min(Math.max(RETRY_SEEK_SEC, sec), Math.max(RETRY_SEEK_SEC, duration - 1)) : sec
  const candidates =
    duration != null
      ? [clampSeek(duration * fraction), clampSeek(duration * alternateSeekFraction(fraction)), RETRY_SEEK_SEC]
      : [FALLBACK_SEEK_SEC, FALLBACK_SEEK_SEC * 2, RETRY_SEEK_SEC]
  const offsets = candidates.filter((ss, i) => candidates.indexOf(ss) === i)
  for (const ss of offsets) {
    try {
      await exec('ffmpeg', ['-y', '-ss', ss.toFixed(2), '-i', url, '-frames:v', '1', '-q:v', '3', destPath], {
        timeout: POSTER_TIMEOUT_MS,
      })
      if (!existsSync(destPath)) continue
      // Near-black frame OR a flat slate/rating card → discard and try the
      // next timestamp of the SAME reel.
      if (isBrightEnoughStill(await stillLumaYAvg(destPath)) && !(await stillIsFlatCard(destPath))) return true
      await unlink(destPath).catch(() => {})
    } catch {
      // try the next offset — a short reel may not reach this seek
    }
  }
  return false
}

async function downloadImageFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS)
    if (!res || !res.ok) return false
    const len = Number(res.headers.get('content-length') ?? '0')
    if (len && len > MAX_IMAGE_BYTES) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) return false
    // archive.org serves stills in formats headless Chromium can't decode
    // (progressive/CMYK JPEG, TIFF, JP2) — ffmpeg accepts them, so validation
    // passes but the Remotion render blanks out. Re-encode every still to a
    // baseline JPEG so what validation approves, Chromium can also draw.
    const rawPath = `${destPath}.raw`
    await writeFile(rawPath, buf)
    try {
      await exec('ffmpeg', ['-y', '-i', rawPath, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '3', destPath], {
        timeout: VALIDATE_TIMEOUT_MS,
      })
      if (existsSync(destPath)) return true
      // ffmpeg couldn't transcode (or is missing): keep the raw bytes as-is —
      // validation downstream still gets its chance to reject them.
      await writeFile(destPath, buf)
      return true
    } finally {
      await unlink(rawPath).catch(() => {})
    }
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

function assetFromCache(cached: StockClip, identifier: string): VisualAsset {
  return {
    kind: 'image',
    source: `https://archive.org/details/${identifier}`,
    license: normalizeLicense(cached.license),
    depictsRealPerson: true,
    aiGenerated: false,
    licenseRef: cached.attribution ?? undefined,
  }
}

/**
 * Resolve ONE archive.org doc to a validated local still: cache check (with
 * junk purge + refetch), metadata → best file, download/poster-grab, junk gate,
 * StockClip bookkeeping. `variant` namespaces the cache entry (e.g. 'beat3')
 * so a REUSED reel yields a different poster frame per beat instead of the
 * identical cached image; image items ignore it (same picture either way).
 * Returns null on any miss — never throws.
 */
export async function resolveDocStill(
  doc: ArchiveDoc,
  opts: ArchiveFootageOptions,
  variant?: string
): Promise<ArchiveFootageResult | null> {
  const identifier = doc.identifier
  if (!identifier) return null
  const cacheId = variant && doc.mediatype !== 'image' ? `${identifier}__${variant}` : identifier

  // 1. Cache check — reuse a prior download for this identifier if the file
  //    is still on disk AND still passes the junk-still gate. A stale corrupt
  //    still (title card grab, truncated download, near-black frame) is purged
  //    so the fresh path below re-fetches it with the new seek/validation logic.
  const cached = await findCachedClip(SOURCE, cacheId)
  if (cached && existsSync(cached.localPath)) {
    if (await validateStillFile(cached.localPath)) {
      // Heal a legacy dark-but-recoverable cached still in place (validate
      // already enforced the hard floor, so the return value is moot here).
      await ensureLegibleStill(cached.localPath)
      const beatsUsed = mergeBeats(cached, opts.beatIndex)
      await recordStockClip({
        source: SOURCE,
        externalId: cacheId,
        localPath: cached.localPath,
        width: cached.width,
        height: cached.height,
        durationSec: cached.durationSec,
        license: cached.license,
        attribution: cached.attribution,
        beatsUsed,
      })
      return { visual: { ...assetFromCache(cached, identifier), beatIndex: opts.beatIndex }, localPath: cached.localPath }
    }
    await unlink(cached.localPath).catch(() => {})
  }

  // 2. Resolve a downloadable file from the item's metadata.
  const meta = await fetchItemMetadata(identifier)
  if (!meta) return null
  const file = pickBestFile(meta, doc.mediatype)
  if (!file) return null

  await ensureStockDir(SOURCE)
  const destPath = stockClipPath(SOURCE, cacheId, 'jpg')

  const url = fileUrl(identifier, file.name)
  const posterOk =
    doc.mediatype === 'image'
      ? await downloadImageFile(url, destPath)
      : await extractPosterFromUrl(url, destPath, opts.beatIndex ?? 0, identifier)
  if (!posterOk) return null

  // 3. Junk-still gate — a corrupt/tiny/near-black still is a miss.
  if (!(await validateStillFile(destPath))) {
    await unlink(destPath).catch(() => {})
    return null
  }
  // Dark-but-recoverable (YAVG in [MIN_STILL_LUMA, BRIGHTEN_LUMA_BELOW)) gets
  // a gamma lift instead of a rejection — tasteful era footage over fallbacks.
  // (validateStillFile above already enforced the hard floor.)
  await ensureLegibleStill(destPath)

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
    externalId: cacheId,
    localPath: destPath,
    license,
    attribution,
    beatsUsed: mergeBeats(cached, opts.beatIndex),
  })

  return { visual, localPath: destPath }
}

/**
 * Finds and downloads a public-domain/archive.org still for a beat query,
 * caching it in StockClip so a repeat query never re-fetches. Returns null
 * on any miss (no results, network failure, ffmpeg unavailable/failed,
 * junk/undecodable still) — never throws, so the caller can always fall
 * through to another source.
 */
export async function fetchArchiveClipForBeat(
  query: string,
  opts: ArchiveFootageOptions = {}
): Promise<ArchiveFootageResult | null> {
  try {
    const collections = opts.collections?.length ? opts.collections : ['prelinger']
    const maxClips = opts.maxClips && opts.maxClips > 0 ? opts.maxClips : MAX_SEARCH_RESULTS
    const docs = (await archiveSearch(query, collections, maxClips)).slice(0, maxClips)

    for (const doc of docs) {
      const result = await resolveDocStill(doc, opts)
      if (result) return result
    }

    return null
  } catch {
    return null
  }
}

/**
 * Pure pick for the per-video pool: the identifier with the LOWEST use count,
 * earliest in `ordered` on ties. Because every identifier starts at 0, no
 * identifier is ever reused until every distinct one has been used once; after
 * exhaustion the picks round-robin. Null only when `ordered` is empty.
 */
export function pickNextIdentifier(
  ordered: string[],
  useCounts: ReadonlyMap<string, number>
): string | null {
  let best: string | null = null
  let bestCount = Infinity
  for (const id of ordered) {
    const count = useCounts.get(id) ?? 0
    if (count < bestCount) {
      best = id
      bestCount = count
    }
  }
  return best
}

/** Injectable seams for ArchiveStillPool so its distribution/relaxation logic
 *  is unit-testable without the network. Production uses the real helpers. */
export interface ArchivePoolDeps {
  search: (query: string, collections: string[], maxResults: number) => Promise<ArchiveDoc[]>
  resolve: (doc: ArchiveDoc, opts: ArchiveFootageOptions, variant?: string) => Promise<ArchiveFootageResult | null>
}

export interface ArchivePoolOptions {
  /** archive.org collections to search first. Default ['prelinger']. */
  collections?: string[]
  /** Beats this pool must serve — drives search breadth and the relaxation trigger. */
  beatCount: number
  /** Floor on search rows (mirrors archiveMaxClips). Default MAX_SEARCH_RESULTS. */
  maxClips?: number
  /** Passed through to each resolved asset. */
  depictsRealPerson?: boolean
}

/**
 * Per-video archive.org still pool (video-quality round 3). Searches ONCE per
 * video — walking the topic-anchored query candidates and accumulating
 * distinct identifiers — then hands each beat a DISTINCT item via
 * pickNextIdentifier, so one reel can no longer paper every beat. When the
 * collection-scoped search finds fewer distinct items than beats, the SAME
 * topic/year queries (never looser ones) are re-run against the curated
 * RELAXED_ARCHIVE_COLLECTIONS — not an unscoped search, which round-3
 * verification showed pulls modern junk into historical stories. Scoped hits
 * sit ahead of relaxed hits in the pool, so the pick order is: unused scoped →
 * unused relaxed → least-used repeats (scoped first on ties). Repeated
 * identifiers (pool exhausted) get a beat-suffixed cache variant, so even a
 * repeat shows a different poster frame of the reel — a tasteful repeat beats
 * junk. Items that fail to resolve are marked dead and never retried. Never
 * throws; every miss degrades to null.
 */
export class ArchiveStillPool {
  private docs: ArchiveDoc[] | null = null
  private readonly useCounts = new Map<string, number>()
  private readonly dead = new Set<string>()

  constructor(
    private readonly queries: string[],
    private readonly opts: ArchivePoolOptions,
    private readonly deps: ArchivePoolDeps = { search: archiveSearch, resolve: resolveDocStill }
  ) {}

  /** One search pass per video, lazily on first acquire. */
  private async ensureDocs(): Promise<ArchiveDoc[]> {
    if (this.docs) return this.docs
    const collections = this.opts.collections?.length ? this.opts.collections : ['prelinger']
    const maxClips = this.opts.maxClips && this.opts.maxClips > 0 ? this.opts.maxClips : MAX_SEARCH_RESULTS
    // Headroom over beatCount: some items will turn out junk/undecodable.
    const rows = Math.max(maxClips, this.opts.beatCount * 2)
    const seen = new Set<string>()
    const docs: ArchiveDoc[] = []
    const gather = async (colls: string[]) => {
      for (const q of this.queries) {
        if (docs.length >= this.opts.beatCount) return
        for (const doc of await this.deps.search(q, colls, rows)) {
          if (!doc.identifier || seen.has(doc.identifier)) continue
          seen.add(doc.identifier)
          docs.push(doc)
        }
      }
    }
    await gather(collections)
    // Too few distinct hits for the beats → relax to the CURATED historical
    // collections (same topic/year queries — the terms stay mandatory) to
    // widen the pool before we allow any identifier to repeat. Never unscoped.
    if (docs.length < this.opts.beatCount) await gather(RELAXED_ARCHIVE_COLLECTIONS)
    this.docs = docs
    return docs
  }

  /** Resolve a still for one beat, preferring never-used identifiers. */
  async acquireStill(beatIndex: number): Promise<ArchiveFootageResult | null> {
    try {
      const docs = await this.ensureDocs()
      for (;;) {
        const alive = docs.filter((d) => d.identifier && !this.dead.has(d.identifier))
        const id = pickNextIdentifier(alive.map((d) => d.identifier as string), this.useCounts)
        if (id == null) return null
        const doc = alive.find((d) => d.identifier === id) as ArchiveDoc
        const uses = this.useCounts.get(id) ?? 0
        // Repeat after exhaustion → beat-suffixed variant = a different frame.
        const variant = uses > 0 ? `beat${beatIndex}` : undefined
        const result = await this.deps.resolve(
          doc,
          { beatIndex, depictsRealPerson: this.opts.depictsRealPerson },
          variant
        )
        if (result) {
          this.useCounts.set(id, uses + 1)
          return result
        }
        this.dead.add(id) // junk/unreachable item — stop retrying it for later beats
      }
    } catch {
      return null
    }
  }
}
