// Per-beat footage resolver — the F10 tier ladder. For each ScriptBeat it walks
// config.footageLadder (default keyless-safe) and stops at the FIRST tier that
// yields a usable still for that beat:
//
//   ai_still  → symbolic AI b-roll (key-gated; never a real-person likeness)
//   stock     → Pexels/Pixabay vertical clip, poster-framed to a still (key-gated)
//   archive   → archive.org public-domain still (keyless; often 'unknown' → review)
//   moodbank  → local CC0 atmosphere clip, poster-framed to a still (keyless)
//   placeholder → NOT handled here; the visuals stage owns the Wikimedia floor
//
// Every tier is thin — it CALLS the Stage-2 helpers (../aiStill, ../stockFootage,
// ../archiveFootage, ../moodBank) and never reimplements them. Nothing here ever
// throws: a tier that lacks a key, misses, or errors simply returns null and the
// ladder falls through. With zero keys and footage disabled the whole stage is a
// no-op and the pipeline behaves exactly as before (Wikimedia slideshow).
//
// imagePaths stays FLAT and beat-ordered, pointing at still images, so the
// current even-split assembleVideo() keeps working unchanged. beatFootage maps
// each beat index to its resolved still(s) for the future pacing-aware assemble.

import { mkdir } from 'fs/promises'
import path from 'path'
import { MEDIA_DIR } from './visuals'
import type { VisualAsset } from '../compliance'
import type { CaseBrief, F10FactoryConfig, F10Script, ScriptBeat } from './types'
import { aiStillTier } from './footage/aiStill'
import { stockTier } from './footage/stock'
import { archiveTier } from './footage/archiveOrg'
import { moodBankTier } from './footage/moodBank'

/** Everything a tier adapter needs to resolve one beat. */
export interface TierInput {
  videoId: string
  beat: ScriptBeat
  beatIndex: number
  /** Safe keyword query derived from beat.visualCue (see cueToQuery). */
  query: string
  /** Archive-tier query: case topic + year + cue (see archiveQuery). May carry
   *  historical names/years — unlike `query`, which never carries an identity.
   *  Optional so the archive tier degrades to `query` if a caller omits it. */
  archiveQuery?: string
  /** Broad-to-narrow fallbacks for the archive tier (see archiveQueryCandidates):
   *  archive.org ANDs terms, so the tier walks these until one has results. */
  archiveQueries?: string[]
  brief: CaseBrief
  config: F10FactoryConfig
  /** Run scratch dir (media/<videoId>). */
  dir: string
  /** Suggested beat-indexed still destination for tiers that produce a file. */
  dest: string
  /** True when the beat's visual cue names a real case subject — AI/stock tiers
   *  must skip so we never imply a synthetic/generic likeness of that person. */
  realSubject: boolean
}

/** What a tier returns on a hit; null means "skip / miss, try the next tier". */
export interface TierOutput {
  /** Local still-image path (flat-compatible with the current assemble). */
  imagePath: string
  /** Honestly-tagged asset so the compliance gate can lint it. */
  asset: VisualAsset
}

export type Tier = (input: TierInput) => Promise<TierOutput | null>

export interface BeatFootageResult {
  /** Beat-ordered assets, each tagged with beatIndex, for the compliance gate. */
  visuals: VisualAsset[]
  /** Flat beat-ordered still paths, parallel to `visuals`. */
  imagePaths: string[]
  /** Winning tier name per image, parallel to `imagePaths` (Asset.provider). */
  imageSources: string[]
  /** beatIndex → resolved still paths (for the pacing-aware assemble to come). */
  beatFootage: Record<number, string[]>
  /** beatIndex → the tier that won that beat (audit / queue UI). */
  footageSources: Record<number, string>
}

// Registered tiers. 'placeholder' is intentionally absent — the visuals stage
// backfills any unfilled beat with the guaranteed keyless Wikimedia floor.
const TIERS: Record<string, Tier> = {
  ai_still: aiStillTier,
  stock: stockTier,
  archive: archiveTier,
  moodbank: moodBankTier,
}

const DEFAULT_LADDER = ['ai_still', 'stock', 'archive', 'moodbank', 'placeholder']

// Accept common synonyms/legacy names for tier keys so a hand-edited or
// older factory config doesn't silently skip a tier. Unknown-after-alias
// tokens are dropped by the TIERS lookup. 'wikimedia'/'commons' map to the
// placeholder floor (owned by the visuals stage), so they're filtered out.
export const TIER_ALIASES: Record<string, string> = {
  ai: 'ai_still',
  aistill: 'ai_still',
  'ai-still': 'ai_still',
  still: 'ai_still',
  stills: 'ai_still',
  pexels: 'stock',
  pixabay: 'stock',
  'archive.org': 'archive',
  archiveorg: 'archive',
  mood: 'moodbank',
  'mood-bank': 'moodbank',
  mood_bank: 'moodbank',
  wikimedia: 'placeholder',
  commons: 'placeholder',
}

// visualCue is free-text mood ("empty courtroom, cold light"), which searches
// poorly against Pexels/archive.org. This table maps common cue themes onto
// safe, generic, non-identifying b-roll queries. Falls through to a sanitized
// version of the cue when nothing matches.
const CUE_QUERY_MAP: { match: RegExp; query: string }[] = [
  { match: /courtroom|court\b|trial|judge|gavel|verdict|jury/i, query: 'empty courtroom interior' },
  { match: /jail|prison|cell|inmate|bars|penitentiary/i, query: 'empty prison hallway' },
  // Checked before the broader police regex so an interrogation-specific cue
  // gets the more precise query (mirrors the 'interrogation' mood-bank category).
  { match: /interrogat|interview room|confession|one-way mirror/i, query: 'dim interrogation room' },
  { match: /police|siren|patrol|squad|cruiser|\bcop\b|detective/i, query: 'police car lights at night' },
  { match: /newspaper|headline|press|clipping|front page|newsprint/i, query: 'vintage newspaper macro' },
  { match: /document|file\b|paperwork|evidence|folder|report|dossier/i, query: 'old documents on a desk' },
  { match: /forest|woods|trees|trail|wilderness/i, query: 'dark foggy forest' },
  { match: /road|highway|street|driving|\bcar\b|vehicle/i, query: 'empty road at night' },
  { match: /house|home|suburb|neighborhood|door|porch|driveway/i, query: 'quiet suburban house at dusk' },
  { match: /rain|storm|weather|fog|mist|downpour/i, query: 'rain on a window' },
  { match: /city|urban|downtown|skyline|alley/i, query: 'city street at night' },
  { match: /water|river|lake|ocean|\bsea\b|beach|shore/i, query: 'still water at dusk' },
  { match: /phone|call\b|dial|telephone/i, query: 'old telephone close up' },
  { match: /clock|\btime\b|hour|midnight/i, query: 'clock close up moody' },
  { match: /map|location|coordinates/i, query: 'old map close up' },
  { match: /night|dark|shadow|moon/i, query: 'dark empty street at night' },
]

/** Map a beat's free-text visual cue to a safe search query, stripping any
 *  real-subject names so a stock/archive search never leaks an identity. */
export function cueToQuery(cue: string, brief: CaseBrief): string {
  const raw = (cue || '').trim()
  for (const { match, query } of CUE_QUERY_MAP) if (match.test(raw)) return query
  let cleaned = raw
  for (const s of brief.subjects) {
    if (!s.name) continue
    cleaned = cleaned.replace(new RegExp(escapeRe(s.name), 'gi'), ' ')
  }
  cleaned = cleaned.replace(/[^a-z0-9,\s]/gi, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || 'dark moody atmosphere'
}

// Filler words dropped from the case name when building an archive query —
// "The Panic of 1907" should search as "panic 1907", not drown in stopwords.
const ARCHIVE_STOPWORDS = /\b(?:the|a|an|of|in|on|at|and|case)\b/gi

/** Build the archive.org search query for a beat. Unlike AI/stock queries —
 *  which must never carry a real person's identity (see namesRealSubject) —
 *  public-domain archive search works far better with the story's own topic
 *  and year ("panic 1907 …" finds era reels; a bare mood phrase finds a random
 *  1963 school film). Living subjects' names (and their distinctive tokens)
 *  are still stripped from the case name — only historical topic words, the
 *  year, and names of subjects explicitly marked not-living are fair game. */
export function archiveQuery(cueQuery: string, brief: CaseBrief): string {
  const topic = archiveTopic(brief)
  const year = brief.year && !topic.includes(String(brief.year)) ? String(brief.year) : ''
  return dedupeTokens([topic, year, (cueQuery || '').trim()]) || 'dark moody atmosphere'
}

/** The story's topic words with living subjects' identities stripped — the
 *  shared base of every archive query. */
function archiveTopic(brief: CaseBrief): string {
  let topic = brief.caseName || ''
  for (const s of brief.subjects) {
    // Fail-closed: only a subject explicitly marked not-living keeps their name.
    if (!s.name || s.living === false) continue
    topic = topic.replace(new RegExp(escapeRe(s.name), 'gi'), ' ')
    for (const part of s.name.split(/\s+/).filter((p) => p.length >= 4)) {
      topic = topic.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'gi'), ' ')
    }
  }
  return topic
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(ARCHIVE_STOPWORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeTokens(parts: string[]): string {
  const seen = new Set<string>()
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
    .join(' ')
}

/** Progressively broader archive.org queries for one beat. archive.org ANDs
 *  every term, so the specific query ("panic 1907 vintage newspaper macro")
 *  often finds NOTHING while "panic 1907" finds era newsreels. The tier tries
 *  each candidate in order and stops at the first with results. */
export function archiveQueryCandidates(cueQuery: string, brief: CaseBrief): string[] {
  const topic = archiveTopic(brief)
  const year = brief.year ? String(brief.year) : ''
  const cue = (cueQuery || '').trim()
  const out: string[] = []
  for (const cand of [
    archiveQuery(cueQuery, brief), // topic + year + cue — most specific
    dedupeTokens([topic, year]),   // topic + year
    topic,                         // topic only
    dedupeTokens([year, cue]),     // era + mood
    cue,                           // generic cue (pre-fix behavior)
  ]) {
    const c = cand.trim()
    if (c && !out.includes(c)) out.push(c)
  }
  if (!out.length) out.push('dark moody atmosphere')
  return out
}

/** True when the beat's VISUAL CUE (not narration) names a real case subject —
 *  the signal that this beat wants to *show* that person, so AI/stock tiers
 *  (which can't honestly depict them) skip and we prefer archival imagery. */
export function namesRealSubject(beat: ScriptBeat, brief: CaseBrief): boolean {
  const hay = (beat.visualCue || '').toLowerCase()
  if (!hay) return false
  return brief.subjects.some((s) => {
    const name = s.name?.toLowerCase().trim()
    if (!name) return false
    if (hay.includes(name)) return true
    // A distinctive surname/token (≥4 chars) counts as naming the subject.
    return name
      .split(/\s+/)
      .filter((p) => p.length >= 4)
      .some((p) => new RegExp(`\\b${escapeRe(p)}\\b`).test(hay))
  })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve per-beat footage by walking the tier ladder. Purely additive and
 * fail-soft: with footage disabled or no beats it returns empty structures so
 * the visuals stage sources everything from Wikimedia exactly as before. Never
 * throws — the whole stage degrades gracefully with zero API keys.
 */
export async function resolveBeatFootage(
  videoId: string,
  script: F10Script,
  brief: CaseBrief,
  config: F10FactoryConfig
): Promise<BeatFootageResult> {
  const empty: BeatFootageResult = {
    visuals: [],
    imagePaths: [],
    imageSources: [],
    beatFootage: {},
    footageSources: {},
  }
  const beats = script.beats ?? []
  if (!config.footageEnabled || beats.length === 0) return empty

  const ladder = (config.footageLadder?.length ? config.footageLadder : DEFAULT_LADDER)
    .map((t) => String(t).trim().toLowerCase())
    .map((t) => TIER_ALIASES[t] ?? t) // resolve synonyms/legacy names to tier keys
    .filter((t) => t && t !== 'placeholder') // visuals stage owns the placeholder floor
    // moodBankEnabled defaults to true (undefined = enabled); only an explicit
    // `false` drops the tier from the ladder.
    .filter((t) => t !== 'moodbank' || config.moodBankEnabled !== false)
  const maxPerBeat = Math.max(1, config.maxImagesPerBeat ?? 1)

  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })

  const visuals: VisualAsset[] = []
  const imagePaths: string[] = []
  const imageSources: string[] = []
  const beatFootage: Record<number, string[]> = {}
  const footageSources: Record<number, string> = {}

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]
    const beatIndex = beat.index ?? i
    const query = cueToQuery(beat.visualCue, brief)
    const archiveQ = archiveQuery(query, brief)
    const archiveQs = archiveQueryCandidates(query, brief)
    const realSubject = namesRealSubject(beat, brief)

    for (const tierName of ladder) {
      if ((beatFootage[beatIndex]?.length ?? 0) >= maxPerBeat) break
      const tier = TIERS[tierName]
      if (!tier) continue

      const n = beatFootage[beatIndex]?.length ?? 0
      const dest = path.join(dir, `beat-${String(beatIndex).padStart(2, '0')}-${n}.jpg`)

      let out: TierOutput | null = null
      try {
        out = await tier({ videoId, beat, beatIndex, query, archiveQuery: archiveQ, archiveQueries: archiveQs, brief, config, dir, dest, realSubject })
      } catch {
        out = null // a tier must never break the ladder
      }
      if (!out || !out.imagePath) continue

      visuals.push({ ...out.asset, beatIndex })
      imagePaths.push(out.imagePath)
      imageSources.push(tierName)
      ;(beatFootage[beatIndex] ??= []).push(out.imagePath)
      if (footageSources[beatIndex] == null) footageSources[beatIndex] = tierName
    }
  }

  return { visuals, imagePaths, imageSources, beatFootage, footageSources }
}
