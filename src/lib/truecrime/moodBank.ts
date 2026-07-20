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
import { readFile, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { ensureLegibleStill, isDetailedEnoughStill, stillEdgeDensity } from './archiveFootage'
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
  // NOTE: 'rain' (and the other nature categories) must stay reachable ONLY via
  // genuine weather/atmosphere words — finance/urban cues map to the
  // document-ish and urban categories below, never to botanical b-roll.
  { category: 'rain', keywords: ['rain', 'storm', 'downpour', 'thunder', 'drizzle'] },
  { category: 'foggy-house', keywords: ['fog', 'foggy', 'mist', 'misty', 'haunt', 'eerie house', 'abandoned house'] },
  { category: 'police-lights', keywords: ['police', 'siren', 'patrol', 'squad car', 'cruiser', 'flashing light'] },
  { category: 'newspaper-macro', keywords: ['newspaper', 'headline', 'newsprint', 'press clipping', 'front page', 'stock', 'market', 'money', 'bank', 'financ', 'economy', 'ledger'] },
  { category: 'night-street', keywords: ['night street', 'city at night', 'downtown', 'urban night', 'streetlight', 'panic', 'crash', 'city', 'crowd', 'factory', 'industry', 'wall street'] },
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

// Nature/botanical atmosphere only ever fits genuine weather/outdoor cues —
// never pick it as a generic fallback (jungle rain behind a financial-panic
// beat reads as a mistake). When a cue matches nothing, prefer these neutral
// categories, in order, before touching anything else in the bank.
const NATURE_CATEGORIES = new Set<MoodCategory>(['rain', 'forest', 'still-water'])
const NEUTRAL_FALLBACK_CATEGORIES: MoodCategory[] = ['night-street', 'foggy-house', 'newspaper-macro', 'highway-night']

/** Mood categories whose clips show unmistakably MODERN subjects (present-day
 *  police cars/lightbars, neon cityscapes, motorway traffic). A pre-1950
 *  history story must never fall back onto these — a modern Škoda behind an
 *  1882 oil-trust beat reads as a mistake (round-4 frame evidence). */
export const ANACHRONISTIC_MOOD_CATEGORIES: MoodCategory[] = ['police-lights', 'night-street', 'highway-night']

/** Stories set before this year get the full vintage relevance treatment:
 *  ANACHRONISTIC_MOOD_CATEGORIES excluded, climate/style-mismatched clips
 *  excluded (see VINTAGE_MISMATCH_TOKENS), and mood clips allowed ONLY on a
 *  direct cue match — never via a generic fallback (round 8). */
export const VINTAGE_CUTOFF_YEAR = 1950

/** Id/tag tokens that mark a clip as climate- or style-mismatched for a
 *  vintage story even when its CATEGORY is cue-appropriate: tropical palm
 *  rain behind a 1903 North Carolina beat reads as a mistake (round-8 frame
 *  evidence) although the cue genuinely asked for rain. A future
 *  period-appropriate rain clip (no such token) would still serve rain cues. */
export const VINTAGE_MISMATCH_TOKENS = ['tropical', 'palm', 'jungle', 'neon', 'modern']

/** True when a clip's id or tags carry a vintage-mismatch token. */
function isVintageMismatch(e: MoodClipEntry): boolean {
  const hay = [e.id, ...(e.tags ?? [])].join(' ').toLowerCase()
  return VINTAGE_MISMATCH_TOKENS.some((t) => hay.includes(t))
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
 * Pure candidate matcher over an in-memory bank (exported for tests). Matches
 * (in order): an exact/keyword category hit, then a direct substring match
 * against any entry's category or tags, then the neutral fallback categories,
 * then any non-nature clip, then the whole bank. `excludeCategories` (e.g.
 * ANACHRONISTIC_MOOD_CATEGORIES for a pre-1950 story) is applied FIRST, so an
 * excluded category can never come back through a fallback; when exclusion
 * empties the bank the result is [] — the tier misses and the placeholder
 * floor (Wikimedia-era imagery) takes the beat instead of a modern clip.
 *
 * `vintage` (round 8) tightens this to RELEVANCE-ONLY for pre-1950 stories:
 * clips carrying a VINTAGE_MISMATCH_TOKENS id/tag are dropped outright (a
 * tropical-palm rain clip can never suit a 1903 beat, even when the cue asks
 * for rain), and there are NO fallbacks — a clip is returned only on a direct
 * cue match, otherwise [] so the era-appropriate Wikimedia floor takes the
 * beat instead of generic atmosphere.
 */
export function pickMoodCandidates(
  bank: MoodClipEntry[],
  cueOrCategory: string,
  excludeCategories: MoodCategory[] = [],
  vintage = false
): MoodClipEntry[] {
  const excluded = new Set(excludeCategories)
  let eligible = bank.filter((e) => !excluded.has(e.category))
  if (vintage) eligible = eligible.filter((e) => !isVintageMismatch(e))
  if (eligible.length === 0) return []

  const category = mapCategory(cueOrCategory)
  const needle = cueOrCategory.toLowerCase()

  let matches =
    category && !excluded.has(category)
      ? eligible.filter((e) => e.category === category)
      : eligible.filter((e) => e.category.toLowerCase().includes(needle) || (e.tags ?? []).some((t) => needle.includes(t.toLowerCase()) || t.toLowerCase().includes(needle)))

  // Vintage stories take cue-matched clips ONLY — an off-topic mood clip
  // reads worse than the Wikimedia placeholder's era imagery (round 8).
  if (vintage) return matches

  // No thematic hit: fall back to the neutral categories (in preference
  // order), then to anything non-nature; the whole eligible bank is the true
  // last resort only when nothing else is populated.
  if (matches.length === 0) {
    for (const neutral of NEUTRAL_FALLBACK_CATEGORIES) {
      matches = eligible.filter((e) => e.category === neutral)
      if (matches.length > 0) break
    }
  }
  if (matches.length === 0) matches = eligible.filter((e) => !NATURE_CATEGORIES.has(e.category))
  if (matches.length === 0) matches = eligible
  return matches
}

/**
 * Pure least-used pick over mood candidates (exported for the tier + tests):
 * the clip with the LOWEST per-video use count wins, earliest candidate on
 * ties — so no clip repeats within one video while an unused eligible clip
 * exists, mirroring the archive pool's pickNextIdentifier. Null on empty.
 */
export function pickLeastUsedClip(
  candidates: MoodClipResult[],
  useCounts: ReadonlyMap<string, number>
): MoodClipResult | null {
  let best: MoodClipResult | null = null
  let bestCount = Infinity
  for (const c of candidates) {
    const count = useCounts.get(c.path) ?? 0
    if (count < bestCount) {
      best = c
      bestCount = count
    }
  }
  return best
}

/**
 * Picks up to `max` mood clips matching a beat's visualCue or an explicit
 * category name (see pickMoodCandidates for the matching ladder). Candidates
 * are rotated by `beatIndex` for a deterministic spread. Returns [] when the
 * bank is empty or `excludeCategories` filters everything out — callers
 * should treat this as "no suitable atmosphere available, keep using the
 * primary footage source / placeholder floor".
 */
export async function selectMoodClips(
  cueOrCategory: string,
  max = 2,
  beatIndex?: number,
  excludeCategories: MoodCategory[] = [],
  vintage = false
): Promise<MoodClipResult[]> {
  const bank = await loadMoodBank()
  let matches = pickMoodCandidates(bank, cueOrCategory, excludeCategories, vintage)
  if (matches.length === 0) return []

  // Deterministic tie-break: rotate the candidate list by beat index so
  // consecutive beats sharing a category spread across its clips without
  // any randomness.
  const offset = Math.max(0, beatIndex ?? 0) % matches.length
  matches = matches.slice(offset).concat(matches.slice(0, offset))

  return matches.slice(0, Math.max(0, max)).map((entry) => ({
    path: path.join(MOOD_BANK_CLIPS_DIR, entry.file),
    asset: toVisualAsset(entry, beatIndex),
    durationSec: entry.durationSec,
  }))
}

/** Clamp a desired seek to the clip's actual duration (probed locally, cheap)
 *  so a wide variation window never seeks past a short clip's end. Falls back
 *  to the old conservative 3.7s cap when the probe fails. */
async function clampSeekToClip(seekSec: number, clipPath: string): Promise<number> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clipPath],
      { timeout: 10_000 }
    )
    const dur = Number(stdout.trim())
    if (Number.isFinite(dur) && dur > 1) return Math.min(seekSec, Math.max(0.5, dur - 0.5))
  } catch {
    /* fall through to the conservative cap */
  }
  return Math.min(seekSec, 3.7)
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
 * beats doesn't produce an identical still every time. Round-4 fix: the old
 * `% 5` wrap made beats 0 and 5 grab the byte-identical frame — the window is
 * now 13 steps (covers every (beat, slot) pair of a realistic beat count) and
 * the seek is clamped to the clip's probed duration instead of a guessed cap,
 * so short clips stay safe without collapsing the variation.
 */
export async function extractMoodStill(
  clipPath: string,
  outPath: string,
  variationIndex = 0
): Promise<string | null> {
  // Round-5: mood stills run the SAME luma gate as every other still that can
  // reach imagePaths (a near-black frame of a night clip rendered as a black
  // beat). Round-8 adds a DETAIL gate on this fallback path only: a
  // near-featureless frame (blank fog, gray mush — edge density < 0.05, see
  // MIN_STILL_EDGE_DENSITY) is rejected the same way. Each candidate seek is
  // extracted, gated, and a rejected frame retries a different timestamp of
  // the same clip before the clip is given up on.
  // 13-step window: (beatIndex*2 + slot) for 6 beats × 2 slots spans 0..11,
  // so every (beat, slot) pair lands on a distinct seek before wrapping; the
  // duration clamp below keeps even the longest seek inside short clips.
  const idx = Math.max(0, variationIndex)
  const rawSeeks = [idx, idx + 4, idx + 8].map((v) => 0.5 + (v % 13) * 0.8)
  const seeks: number[] = []
  for (const raw of rawSeeks) {
    const clamped = await clampSeekToClip(raw, clipPath)
    if (!seeks.some((s) => Math.abs(s - clamped) < 0.05)) seeks.push(clamped)
  }
  for (const seek of seeks) {
    try {
      await exec(
        'ffmpeg',
        [
          '-y',
          '-ss', seek.toFixed(2),
          '-i', clipPath,
          '-frames:v', '1',
          '-vf', 'hqdn3d=4:3:6:4,scale=1620:2880:force_original_aspect_ratio=increase:flags=lanczos,crop=1620:2880',
          outPath,
        ],
        { timeout: 30_000 }
      )
      if (!existsSync(outPath)) continue
      if ((await ensureLegibleStill(outPath)) && isDetailedEnoughStill(await stillEdgeDensity(outPath))) {
        return outPath
      }
      await unlink(outPath).catch(() => {}) // near-black or featureless frame → try another timestamp
    } catch {
      /* extraction failed at this seek — try the next one */
    }
  }
  return null
}
