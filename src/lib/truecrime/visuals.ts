// Visuals stage. Sources public-domain / Creative-Commons imagery from Wikimedia
// Commons for the case + its subjects, tags each with its real license (so the
// gate's visual lint and disclosure planner have provenance), and downloads the
// thumbnails for the slideshow render. No AI likenesses are ever generated here
// — only real, licensed archival imagery.

import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { fetchBufferBudget, fetchJsonBudget } from './budget'
import type { AssetLicense, VisualAsset } from '../compliance'
import type { CaseBrief } from './types'

export const MEDIA_DIR = path.join(process.cwd(), 'media')
const UA = 'ContentEngine-F10/1.0 (local content tool)'
// Round 7: whole-request budgets so a stalled Commons response can never hang
// the visuals stage (same failure class as the archive.org footage hang).
const SEARCH_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 90_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

interface CommonsPage {
  title: string
  imageinfo?: {
    url: string
    thumburl?: string
    extmetadata?: { LicenseShortName?: { value?: string }; Artist?: { value?: string } }
  }[]
}

function mapLicense(short: string | undefined): AssetLicense {
  const s = (short ?? '').toLowerCase()
  if (s.includes('public domain') || s.includes('pd-')) return 'public_domain'
  if (s.includes('cc0')) return 'cc0'
  if (s.includes('cc by') || s.includes('cc-by')) return 'cc_by'
  if (s) return 'licensed' // some other CC/attribution license — keep its ref
  return 'unknown'
}

async function commonsSearch(query: string, limit: number): Promise<CommonsPage[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
    `&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}` +
    // Request a 1800px-wide thumbnail (was 1080): the slideshow upscales to
    // 1080×1920+, so a 1080-wide source was blown up ~2.7× and read soft. 1800
    // gives Chromium/ffmpeg real pixels to work with at 9:16 output width.
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1800'
  const data = (await fetchJsonBudget(url, { timeoutMs: SEARCH_TIMEOUT_MS, headers: { 'User-Agent': UA } })) as
    | { query?: { pages?: Record<string, CommonsPage> } }
    | null
  return Object.values(data?.query?.pages ?? {})
}

function toAsset(page: CommonsPage, depictsRealPerson: boolean): VisualAsset | null {
  const info = page.imageinfo?.[0]
  if (!info) return null
  // Skip non-photo media that won't render well as a still.
  if (/\.(svg|ogg|ogv|webm|pdf|tif)$/i.test(info.url)) return null
  const license = mapLicense(info.extmetadata?.LicenseShortName?.value)
  return {
    kind: 'image',
    source: info.thumburl ?? info.url,
    license,
    depictsRealPerson,
    aiGenerated: false,
    licenseRef: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '').slice(0, 120),
  }
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const buf = await fetchBufferBudget(url, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      headers: { 'User-Agent': UA },
      maxBytes: MAX_IMAGE_BYTES,
    })
    if (!buf) return false
    await writeFile(dest, buf)
    return true
  } catch {
    return false
  }
}

/**
 * Returns the sourced VisualAssets and the local file paths that downloaded
 * successfully (parallel arrays, both filtered to successes). Prefers
 * public-domain assets and caps at config.maxImages.
 */
export async function sourceVisuals(
  videoId: string,
  brief: CaseBrief,
  maxImages = 6
): Promise<{ visuals: VisualAsset[]; imagePaths: string[] }> {
  const subjectNames = brief.subjects
    .filter((s) => s.role !== 'victim' || !s.isMinor) // never fetch minor imagery
    .map((s) => s.name)

  // Subject portraits first (most relevant), then case-level imagery.
  const queries = [...subjectNames.map((n) => ({ q: n, person: true })), { q: brief.caseName, person: false }]

  const found: VisualAsset[] = []
  for (const { q, person } of queries) {
    const pages = await commonsSearch(q, 4)
    for (const p of pages) {
      const asset = toAsset(p, person)
      if (asset && !found.some((f) => f.source === asset.source)) found.push(asset)
    }
  }

  // Public-domain / CC0 first, then the rest, capped.
  const ranked = found.sort((a, b) => licenseRank(a.license) - licenseRank(b.license)).slice(0, maxImages)

  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })

  const visuals: VisualAsset[] = []
  const imagePaths: string[] = []
  let i = 0
  for (const asset of ranked) {
    const dest = path.join(dir, `img-${String(i).padStart(2, '0')}.jpg`)
    if (await download(asset.source, dest)) {
      visuals.push(asset)
      imagePaths.push(dest)
      i++
    }
  }
  return { visuals, imagePaths }
}

function licenseRank(l: AssetLicense): number {
  return { public_domain: 0, cc0: 1, cc_by: 2, licensed: 3, fair_use: 4, ai_generated: 5, unknown: 6 }[l]
}
