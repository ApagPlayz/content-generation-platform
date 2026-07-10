// Mood bank read helper. Fail-soft, no network, no Prisma — reads whatever
// scripts/populate-mood-bank.mjs has already downloaded into
// assets/mood-bank/clips/ (per assets/mood-bank/manifest.json) and returns
// generic atmospheric clips (rain, foggy exteriors, police lights, newspaper
// macro, night streets, courtrooms, prison hallways, forests, night highways,
// still water, interrogation rooms) for beats whose visualCue doesn't map to
// real case imagery. Returns [] whenever the bank is empty or unreadable so
// callers can always fall through to their existing footage source — this is
// a LATE rung of the footage ladder, not a required one.
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import type { AssetLicense, VisualAsset } from '../compliance'

const exec = promisify(execFile)

export const MOOD_BANK_DIR = path.join(process.cwd(), 'assets', 'mood-bank')
export const MOOD_BANK_CLIPS_DIR = path.join(MOOD_BANK_DIR, 'clips')
export const MOOD_BANK_MANIFEST_PATH = path.join(MOOD_BANK_DIR, 'manifest.json')

export type MoodCategory =
  | 'rain'
  | 'foggy-house'
  | 'police-lights'
  | 'newspaper-macro'
  | 'night-street'
  | 'courtroom'
  | 'prison'
  | 'forest'
  | 'highway-night'
  | 'still-water'
  | 'interrogation'
  | string

/** One entry from manifest.json. Fields mirror assets/mood-bank/README.md's
 *  schema table; parsed defensively (as-cast) since the manifest is a raw
 *  JSON file, not a validated/typed store. */
export interface MoodClipEntry {
  id: string
  category: MoodCategory
  tags?: string[]
  description?: string
  file: string
  source: 'archive.org' | 'pexels' | string
  sourceId?: string
  sourceUrl?: string
  downloadUrl?: string
  license?: AssetLicense
  licenseRef?: string
  attribution?: string
  durationSec?: number
  width?: number
  height?: number
  depictsRealPerson?: boolean
  aiGenerated?: boolean
  populated?: boolean
}

/** A resolved mood clip ready for the footage/compliance pipeline. */
export interface MoodClipResult {
  path: string
  asset: VisualAsset
  durationSec?: number
}

// Keyword → category map for mapping a beat's free-text visualCue onto the
// mood-bank vocabulary. Falls through to a direct category/tag substring
// match when nothing here hits. Kept in step with footage.ts's CUE_QUERY_MAP
// so the same beat theme (e.g. "courtroom") resolves to the same idea whether
// it lands on the stock/archive tier (which searches CUE_QUERY_MAP's query
// text) or falls all the way to this local moodbank tier.
const KEYWORD_CATEGORIES: { category: MoodCategory; keywords: string[] }[] = [
  { category: 'rain', keywords: ['rain', 'storm', 'downpour', 'thunder', 'drizzle'] },
  { category: 'foggy-house', keywords: ['fog', 'foggy', 'mist', 'misty', 'haunt', 'eerie house', 'abandoned house'] },
  { category: 'police-lights', keywords: ['police', 'siren', 'patrol', 'squad car', 'cruiser', 'flashing light'] },
  { category: 'newspaper-macro', keywords: ['newspaper', 'headline', 'newsprint', 'press clipping', 'front page'] },
  { category: 'night-street', keywords: ['night street', 'city at night', 'downtown', 'urban night', 'streetlight'] },
  { category: 'courtroom', keywords: ['courtroom', 'court room', 'trial', 'judge', 'gavel', 'verdict', 'jury'] },
  { category: 'prison', keywords: ['jail', 'prison', 'cell block', 'inmate', 'penitentiary', 'behind bars'] },
  { category: 'forest', keywords: ['forest', 'woods', 'wooded', 'tree line', 'wilderness trail'] },
  { category: 'highway-night', keywords: ['highway', 'empty road', 'open road', 'driving at night', 'roadside'] },
  { category: 'still-water', keywords: ['still water', 'river', 'lakeside', 'lake', 'ocean', 'shoreline'] },
  { category: 'interrogation', keywords: ['interrogation', 'interview room', 'one-way mirror', 'confession room'] },
]

/** Reads and parses manifest.json, filtering to entries whose clip file is
 *  actually present on disk. Returns [] on any error (missing file, bad
 *  JSON, unreadable) — never throws. */
export async function loadMoodBank(): Promise<MoodClipEntry[]> {
  try {
    const raw = await readFile(MOOD_BANK_MANIFEST_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as MoodClipEntry[]).filter(
      (e) => e && e.populated && typeof e.file === 'string' && existsSync(path.join(MOOD_BANK_CLIPS_DIR, e.file))
    )
  } catch {
    return []
  }
}

function mapCategory(cueOrCategory: string): MoodCategory | null {
  const s = cueOrCategory.toLowerCase()
  for (const { category, keywords } of KEYWORD_CATEGORIES) {
    if (category === s || keywords.some((k) => s.includes(k))) return category
  }
  return null
}

function toVisualAsset(entry: MoodClipEntry, beatIndex?: number): VisualAsset {
  return {
    kind: 'video',
    source: entry.sourceUrl ?? entry.downloadUrl ?? `mood-bank:${entry.id}`,
    license: entry.license ?? 'unknown',
    // Honor the manifest's own honesty tags so an accidentally-added clip that
    // shows a real person or is AI-generated still reaches visualLint / the
    // disclosure plan. Safe person-free CC0 default when the field is absent.
    depictsRealPerson: entry.depictsRealPerson ?? false,
    aiGenerated: entry.aiGenerated ?? false,
    licenseRef: entry.licenseRef ?? entry.attribution,
    beatIndex,
  }
}

/**
 * Picks up to `max` mood clips matching a beat's visualCue or an explicit
 * category name. Matches (in order): an exact/keyword category hit, then a
 * direct substring match against any entry's category or tags. Returns []
 * when the bank is empty or nothing matches — callers should treat this as
 * "no generic atmosphere available, keep using the primary footage source".
 */
export async function selectMoodClips(
  cueOrCategory: string,
  max = 2,
  beatIndex?: number
): Promise<MoodClipResult[]> {
  const bank = await loadMoodBank()
  if (bank.length === 0) return []

  const category = mapCategory(cueOrCategory)
  const needle = cueOrCategory.toLowerCase()

  let matches = category
    ? bank.filter((e) => e.category === category)
    : bank.filter((e) => e.category.toLowerCase().includes(needle) || (e.tags ?? []).some((t) => needle.includes(t.toLowerCase()) || t.toLowerCase().includes(needle)))

  if (matches.length === 0) matches = bank // last resort: any generic atmosphere beats none at all

  return matches.slice(0, Math.max(0, max)).map((entry) => ({
    path: path.join(MOOD_BANK_CLIPS_DIR, entry.file),
    asset: toVisualAsset(entry, beatIndex),
    durationSec: entry.durationSec,
  }))
}

/**
 * Best-effort still-frame extraction from a mood clip (ffmpeg), for the
 * current still-only assemble path. Returns null on any failure (missing
 * ffmpeg, bad clip, etc.) — never throws.
 *
 * Many mood-bank/archive sources are small (some archive.org transcodes are
 * 320×240-class), and this still ultimately gets blown up to a 1080×1920
 * frame downstream — a plain nearest/bilinear upscale of that reads as
 * blocky. So the extraction itself denoises (hqdn3d, cheap on a single
 * frame) and upscales with a lanczos-filtered scale, which reads as
 * intentional filmic grain instead of compression blockiness. The target
 * size (1620×2880) matches kenBurns.ts's 1.5× Ken-Burns oversample frame, so
 * the still only gets upscaled ONCE here with the good filter — the
 * downstream Ken-Burns scale then sees an already-correctly-sized image and
 * is effectively a no-op instead of a second, lower-quality upscale.
 *
 * `variationIndex` (e.g. the beat index or timeline slice index) nudges the
 * seek point forward a few seconds so the SAME clip reused across multiple
 * beats doesn't produce an identical still every time. It's wrapped and
 * capped low enough to stay inside even the bank's shortest known clips.
 */
export async function extractMoodStill(
  clipPath: string,
  outPath: string,
  variationIndex = 0
): Promise<string | null> {
  const seekSec = (0.5 + (Math.max(0, variationIndex) % 5) * 0.8).toFixed(2)
  try {
    await exec(
      'ffmpeg',
      [
        '-y',
        '-ss', seekSec,
        '-i', clipPath,
        '-frames:v', '1',
        '-vf', 'hqdn3d=4:3:6:4,scale=1620:2880:force_original_aspect_ratio=increase:flags=lanczos,crop=1620:2880',
        outPath,
      ],
      { timeout: 30_000 }
    )
    return existsSync(outPath) ? outPath : null
  } catch {
    return null
  }
}
