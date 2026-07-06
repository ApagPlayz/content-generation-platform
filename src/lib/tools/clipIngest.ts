import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { IngestResult } from './types'

const exec = promisify(execFile)

export const MEDIA_DIR = path.join(process.cwd(), 'media')

// We only keep a ~20s highlight, so there's no need to pull a whole 10–30 min
// reel (hundreds of MB, minutes of transfer, frequent timeouts). Grab a window
// from the start that's big enough for moment-detect to search within, then cut
// the final clip from it. Tunable via the factory's `ingestWindowSec` config.
const DEFAULT_INGEST_WINDOW_SEC = 90

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await exec('which', [cmd])
    return true
  } catch {
    return false
  }
}

/**
 * Find and download the source highlight reel via yt-dlp (capped at 720p —
 * we only need a vertical crop of it). Returns the local path + metadata.
 */
export async function runClipIngest(
  videoId: string,
  youtubeQuery: string,
  windowSec: number = DEFAULT_INGEST_WINDOW_SEC
): Promise<IngestResult> {
  if (!(await commandExists('yt-dlp'))) {
    throw new Error('yt-dlp not installed. Install with: brew install yt-dlp')
  }

  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })
  const outTemplate = path.join(dir, 'source.%(ext)s')

  // Resolve the search to a concrete video first so we can store its URL.
  const { stdout: meta } = await exec(
    'yt-dlp',
    [
      `ytsearch1:${youtubeQuery}`,
      '--print', '%(webpage_url)s\t%(duration)s',
      '--no-download',
      '--match-filter', 'duration < 1800',
    ],
    { timeout: 60_000 }
  )
  const [url, durationStr] = meta.trim().split('\t')
  if (!url) throw new Error(`No YouTube result for query: ${youtubeQuery}`)

  const fullDuration = Math.round(Number(durationStr) || 0)

  // Only fetch a window from the start unless the whole video is already short.
  // --download-sections (ffmpeg-backed) avoids pulling the entire reel; the
  // keyframe flag keeps the cut accurate so moment-detect timestamps line up.
  const sectionArgs =
    fullDuration === 0 || fullDuration > windowSec
      ? ['--download-sections', `*0-${windowSec}`, '--force-keyframes-at-cuts']
      : []

  await exec(
    'yt-dlp',
    [
      url,
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '-o', outTemplate,
      '--no-playlist',
      ...sectionArgs,
    ],
    { timeout: 600_000 }
  )

  const sourcePath = path.join(dir, 'source.mp4')
  if (!existsSync(sourcePath)) {
    throw new Error(`yt-dlp finished but ${sourcePath} not found`)
  }

  // The clip we actually downloaded is at most `windowSec` long; report that
  // (not the full reel length) so downstream moment-detect bounds are correct.
  const durationSec =
    fullDuration === 0 ? windowSec : Math.min(fullDuration, windowSec)

  return {
    sourcePath,
    youtubeUrl: url,
    durationSec,
  }
}
