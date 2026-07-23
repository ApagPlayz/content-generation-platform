// YouTube clip source for the relevant moving-clip layer. Uses yt-dlp (a local
// CLI, keyless) to SEARCH for on-topic public videos — news reports, press
// conferences, released bodycam/court/police footage, documentaries — and to
// download only a SHORT excerpt of the best hit, which is then normalised to
// the same muted 1080×1920 clip the archive.org path produces.
//
// This is the fair-use / commentary-genre path the true-crime + history space
// runs on: short excerpts (hard-capped by the caller), transformative narration
// always over the top, multiple distinct sources per video, and an attribution
// line per source appended to the description. Nothing here is public-domain-
// only; provenance is logged, not assumed permissive.
//
// Every step degrades to null/false and never throws: no yt-dlp on PATH, a
// search miss, a geo/age-blocked video, or an ffmpeg failure simply means the
// caller falls through to the next candidate (or to photos-only).

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, readdir, rm } from 'fs/promises'
import path from 'path'
import { normalizeClipFile } from '../archiveFootage'

const exec = promisify(execFile)

const SEARCH_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 120_000
/** Never pull an excerpt from a video shorter than this — too little to seek
 *  past an intro and still land a meaningful window. */
const MIN_SOURCE_DURATION_SEC = 20

/** One YouTube search hit, pre-download. */
export interface YouTubeCandidate {
  id: string
  title: string
  channel: string
  url: string
  durationSec: number | null
}

/** Channel-name signals that mark an authoritative source (news / government /
 *  official). Used only to RANK candidates that already pass the relevance
 *  filter — it never lets an off-topic video through. */
const AUTHORITY_RE =
  /\b(news|press|associated press|reuters|ap\b|abc|nbc|cbs|cnn|bbc|pbs|c-?span|gov|government|police|sheriff|department|official|archive|court|nasa|smithsonian|history|guardian|times|post|tribune|herald)\b/i

let ytDlpChecked: boolean | null = null
/** True when the yt-dlp binary is on PATH. Memoised per process. */
export async function ytDlpAvailable(): Promise<boolean> {
  if (ytDlpChecked !== null) return ytDlpChecked
  try {
    await exec('which', ['yt-dlp'])
    ytDlpChecked = true
  } catch {
    ytDlpChecked = false
  }
  return ytDlpChecked
}

/** Rank score for a candidate: authoritative channels first, then longer
 *  sources (more room to pick a clean window). Pure; exported for tests. */
export function authorityScore(channel: string): number {
  return AUTHORITY_RE.test(channel || '') ? 1 : 0
}

/** Order candidates best-first by authority then duration. Stable, pure. */
export function rankYouTubeCandidates(cands: YouTubeCandidate[]): YouTubeCandidate[] {
  return [...cands].sort(
    (a, b) => authorityScore(b.channel) - authorityScore(a.channel) || (b.durationSec ?? 0) - (a.durationSec ?? 0)
  )
}

interface YtFlatEntry {
  id?: string
  title?: string
  channel?: string
  uploader?: string
  duration?: number
  url?: string
}

/** Parse yt-dlp's newline-delimited JSON (`-j`) into candidates. Skips entries
 *  with no id/title. Pure; exported for tests. */
export function parseYtSearchJson(stdout: string): YouTubeCandidate[] {
  const out: YouTubeCandidate[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let e: YtFlatEntry
    try {
      e = JSON.parse(t) as YtFlatEntry
    } catch {
      continue
    }
    if (!e.id || !e.title) continue
    out.push({
      id: e.id,
      title: e.title,
      channel: e.channel || e.uploader || '',
      url: e.url && /^https?:/.test(e.url) ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
      durationSec: typeof e.duration === 'number' && e.duration > 0 ? e.duration : null,
    })
  }
  return out
}

/**
 * Search YouTube for `count` on-topic videos via yt-dlp's `ytsearchN:` provider
 * (flat playlist — one metadata fetch, no downloads). Returns [] on any failure
 * or when yt-dlp is absent. Never throws.
 */
export async function searchYouTubeClips(query: string, count: number): Promise<YouTubeCandidate[]> {
  if (!(await ytDlpAvailable())) return []
  const n = Math.max(1, Math.min(20, Math.floor(count)))
  try {
    const { stdout } = await exec(
      'yt-dlp',
      ['-j', '--flat-playlist', '--no-warnings', '--no-playlist', `ytsearch${n}:${query}`],
      { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    )
    return parseYtSearchJson(stdout)
  } catch {
    return []
  }
}

/**
 * Download a SHORT excerpt of one YouTube video and normalise it to the shared
 * muted 1080×1920 clip. yt-dlp fetches ONLY the `clipLenSec` window
 * (`--download-sections`), seeking ~20% in to skip intros; ffmpeg then strips
 * audio and cover-frames it. Returns false (never throws) on any failure. The
 * caller owns the on-screen cap; `clipLenSec` should already be ≤ that cap.
 */
export async function downloadYouTubeClip(
  cand: YouTubeCandidate,
  clipLenSec: number,
  destPath: string
): Promise<boolean> {
  if (!(await ytDlpAvailable())) return false
  if (cand.durationSec != null && cand.durationSec < MIN_SOURCE_DURATION_SEC) return false
  const dur = cand.durationSec
  // Seek ~20% in (skip intros/lower-thirds), clamped so the window fits.
  const start = dur ? Math.min(Math.max(3, dur * 0.2), Math.max(3, dur - clipLenSec - 1)) : 5
  const end = start + Math.max(1, clipLenSec)
  const tmpDir = `${destPath}.ytd`
  try {
    await mkdir(tmpDir, { recursive: true })
    await exec(
      'yt-dlp',
      ['-q', '--no-warnings', '--no-playlist',
        // Prefer a ≤720p progressive/video-only stream — small, fast, and plenty
        // for a cover-framed 9:16 excerpt.
        '-f', 'bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/best',
        '--download-sections', `*${start.toFixed(1)}-${end.toFixed(1)}`,
        '--force-keyframes-at-cuts',
        '-o', path.join(tmpDir, 'src.%(ext)s'),
        cand.url],
      { timeout: DOWNLOAD_TIMEOUT_MS }
    )
    const files = (await readdir(tmpDir)).filter((f) => !f.startsWith('.'))
    if (!files.length) return false
    const raw = path.join(tmpDir, files[0])
    return await normalizeClipFile(raw, destPath)
  } catch {
    return false
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
