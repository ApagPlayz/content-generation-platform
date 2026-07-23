// Relevant moving-clip layer (rebuilt 2026-07-22). Photos are the backbone
// (Wikipedia/Commons via visuals.ts); this module lays SHORT, strictly
// RELEVANCE-FILTERED moving clips over a subset of beats — real on-topic
// footage of the actual story, never generic era mood b-roll.
//
// Two sources, tried in config order:
//   • archive.org movies — public-domain newsreels / government / documentary
//     film (keyless).
//   • YouTube via yt-dlp — short fair-use excerpts of news reports, press
//     conferences, released bodycam/court/police footage, documentaries.
//
// Fair-use / commentary-genre mechanics, enforced in CODE (not suggestions):
//   • short excerpts only (download length capped, on-screen time capped by the
//     render timeline at MAX_CLIP_ONSCREEN_SEC, never > 10s from one source),
//   • narration always over the top (clips are muted here),
//   • multiple DISTINCT sources per video (one clip per source, deduped),
//   • an attribution line per source appended to the description.
//
// Every step degrades to null/empty and never throws: no yt-dlp, a search miss,
// a blocked video, or an ffmpeg failure simply means fewer (or zero) clips and
// the render falls back to the photo backbone.

import { mkdir } from 'fs/promises'
import path from 'path'
import { MEDIA_DIR, topicTokens, relevanceScore } from '../visuals'
import { archiveSearch, resolveArchiveClip, type ArchiveDoc } from '../archiveFootage'
import {
  searchYouTubeClips,
  downloadYouTubeClip,
  rankYouTubeCandidates,
  type YouTubeCandidate,
} from './youtubeClips'
import { MAX_CLIP_ONSCREEN_SEC } from '../timeline'
import { MIN_USABLE_IMAGES } from '../visuals'
import type { VisualAsset } from '../../compliance'
import type { CaseBrief, ClipAttribution, F10FactoryConfig, F10Script } from '../types'

/** Never download more than this many seconds from ONE source (fair-use cap;
 *  the render timeline caps ON-SCREEN time even lower at MAX_CLIP_ONSCREEN_SEC). */
export const MAX_CLIP_DOWNLOAD_SEC = 10
/** Default cap on beats that receive a moving clip — keeps photos the majority. */
export const DEFAULT_MAX_CLIP_BEATS = 3
/** Default wall-clock budget for the whole clip-sourcing pass. Past it no NEW
 *  download starts and we ship whatever clips already landed. */
export const DEFAULT_CLIP_BUDGET_SEC = 300
/** Minimum photos that must anchor a video regardless of clips (backbone). */
export const MIN_PHOTOS = 3

/** A source-agnostic clip candidate, ranked before download. */
interface ClipCandidate {
  source: 'archive' | 'youtube'
  /** Distinct source key (archive identifier / youtube id) for dedup. */
  key: string
  title: string
  channel?: string
  /** Human-facing source URL (attribution + provenance). */
  url: string
  /** Relevance score (distinct on-topic token matches). */
  score: number
  /** Downloader bound to this candidate. */
  download: (clipLenSec: number, dest: string) => Promise<boolean>
}

/** Injectable source seams so the orchestration is unit-testable offline. */
export interface ClipResolveDeps {
  searchArchive: typeof archiveSearch
  resolveArchive: typeof resolveArchiveClip
  searchYouTube: typeof searchYouTubeClips
  downloadYouTube: typeof downloadYouTubeClip
}

const DEFAULT_DEPS: ClipResolveDeps = {
  searchArchive: archiveSearch,
  resolveArchive: resolveArchiveClip,
  searchYouTube: searchYouTubeClips,
  downloadYouTube: downloadYouTubeClip,
}

export interface BeatClipsResult {
  /** beatIndex → resolved clip path(s). At most one clip per beat here. */
  beatClips: Record<number, string[]>
  /** One attribution per downloaded clip (title/channel/url). */
  attributions: ClipAttribution[]
  /** One VisualAsset per downloaded clip (kind:'video', fair-use, attributed). */
  visuals: VisualAsset[]
}

const EMPTY: BeatClipsResult = { beatClips: {}, attributions: [], visuals: [] }

/** Topic tokens for relevance, with the bare event YEAR removed — a year-only
 *  title match ("1937 newsreel") is NOT enough to prove on-topic. Pure. */
export function relevanceTokens(brief: CaseBrief): Set<string> {
  const toks = new Set(topicTokens(brief))
  if (brief.year) toks.delete(String(brief.year))
  return toks
}

function descText(doc: ArchiveDoc): string {
  const d = doc.description
  return Array.isArray(d) ? d.join(' ') : d ?? ''
}

/** True when `text` shares at least `minTokens` distinct on-topic tokens with
 *  the brief — the strict relevance floor a clip must clear. Pure. */
export function isRelevantClipText(text: string, tokens: Set<string>, minTokens: number): boolean {
  return relevanceScore(text, tokens) >= Math.max(1, minTokens)
}

/**
 * Spread `count` clips across the beats: pick beat indices at roughly even
 * intervals so clips punctuate the video rather than clumping. Pure; exported
 * for tests.
 */
export function pickClipBeatIndices(beatIndices: number[], count: number): number[] {
  const sorted = [...new Set(beatIndices)].sort((a, b) => a - b)
  const n = sorted.length
  if (count <= 0 || n === 0) return []
  if (count >= n) return sorted
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    const pos = Math.min(n - 1, Math.max(0, Math.round(((k + 1) * n) / (count + 1))))
    if (!out.includes(sorted[pos])) out.push(sorted[pos])
  }
  for (const s of sorted) {
    if (out.length >= count) break
    if (!out.includes(s)) out.push(s)
  }
  return out.slice(0, count).sort((a, b) => a - b)
}

/** Format the attribution lines appended to the video description. Pure. */
export function formatAttributionLines(attrs: ClipAttribution[]): string[] {
  return attrs.map((a) => {
    const who = a.channel ? `${a.title} — ${a.channel}` : a.title
    return `Footage: ${who} (${a.url})`
  })
}

/** Append a "Sources / footage" attribution block to a description, idempotent
 *  (never doubles the block on a re-run). Pure; exported for tests. */
export function appendAttribution(description: string, attrs: ClipAttribution[]): string {
  const lines = formatAttributionLines(attrs)
  if (!lines.length) return description
  const base = description.split('\n\nFootage credits:')[0]
  return `${base}\n\nFootage credits:\n${lines.join('\n')}`
}

/**
 * Hard media floor for a run (replaces the photo-only floor when clips are in
 * play): photos must still anchor the video (≥ MIN_PHOTOS) AND the combined
 * usable-asset count (photos + clips) must reach `min`. Throws an owner-legible
 * error otherwise. Pure; exported for tests.
 */
export function enforceMediaFloor(
  photoCount: number,
  clipCount: number,
  topic: string,
  min: number = MIN_USABLE_IMAGES,
  minPhotos: number = MIN_PHOTOS
): void {
  if (photoCount < minPhotos) {
    throw new Error(
      `only ${photoCount} usable photo${photoCount === 1 ? '' : 's'} for "${topic}" — ` +
        `photos are the backbone (need ≥ ${minPhotos})`
    )
  }
  const total = photoCount + clipCount
  if (total < min) {
    throw new Error(
      `only ${total} usable visual asset${total === 1 ? '' : 's'} (${photoCount} photos + ${clipCount} clips) ` +
        `for "${topic}" — not rendering a starved slideshow (need ≥ ${min})`
    )
  }
}

/** Build the ordered, deduped candidate pool from the configured sources. */
async function gatherCandidates(
  brief: CaseBrief,
  config: F10FactoryConfig,
  deps: ClipResolveDeps
): Promise<ClipCandidate[]> {
  const tokens = relevanceTokens(brief)
  const minTokens = config.clipRelevanceMinTokens ?? 1
  const minHeight = config.minClipHeight
  const query = brief.caseName
  const sources = config.clipSources?.length ? config.clipSources : ['archive', 'youtube']
  const out: ClipCandidate[] = []
  const seen = new Set<string>()

  for (const src of sources.map((s) => s.trim().toLowerCase())) {
    if (src === 'archive') {
      // All collections (owner runs on the fair-use/commentary model, not PD-only),
      // movies only, relevance-filtered on title + description.
      let docs: ArchiveDoc[] = []
      try {
        docs = await deps.searchArchive(query, [], Math.max(8, (config.maxClipBeats ?? DEFAULT_MAX_CLIP_BEATS) * 4), false)
      } catch {
        docs = []
      }
      // Filter on the TITLE (the per-reel signal) so a multi-topic compilation
      // that only mentions the topic in its description — e.g. a whole sci-fi
      // series where one episode touches the story — can't qualify and then
      // serve an off-topic grab. Description still boosts RANKING among titles
      // that already qualify.
      const scored = docs
        .filter((d) => d.identifier && d.mediatype === 'movies')
        .map((d) => ({
          d,
          titleScore: relevanceScore(d.title ?? '', tokens),
          score: relevanceScore(`${d.title ?? ''} ${descText(d)}`, tokens),
        }))
        .filter((x) => x.titleScore >= Math.max(1, minTokens))
        .sort((a, b) => b.score - a.score)
      for (const { d, score } of scored) {
        const key = `archive:${d.identifier}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          source: 'archive',
          key,
          title: d.title ?? d.identifier!,
          url: `https://archive.org/details/${d.identifier}`,
          score,
          download: (len, dest) => deps.resolveArchive(d, len, dest, minHeight),
        })
      }
    } else if (src === 'youtube') {
      let cands: YouTubeCandidate[] = []
      try {
        cands = await deps.searchYouTube(query, config.youtubeClipSearchCount ?? 6)
      } catch {
        cands = []
      }
      const relevant = rankYouTubeCandidates(
        cands.filter((c) => isRelevantClipText(c.title, tokens, minTokens))
      )
      for (const c of relevant) {
        const key = `youtube:${c.id}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          source: 'youtube',
          key,
          title: c.title,
          channel: c.channel,
          url: c.url,
          score: relevanceScore(c.title, tokens),
          download: (len, dest) => deps.downloadYouTube(c, len, dest),
        })
      }
    }
  }
  return out
}

/**
 * Resolve relevant moving clips for a video. Returns at most `maxClipBeats`
 * distinct-source clips, spread across the beats. Empty (never throws) when
 * clips are disabled, no beats exist, or nothing relevant resolves — the render
 * then uses the photo backbone alone (a common, acceptable outcome).
 */
export async function resolveBeatClips(
  videoId: string,
  script: F10Script,
  brief: CaseBrief,
  config: F10FactoryConfig,
  deps: ClipResolveDeps = DEFAULT_DEPS
): Promise<BeatClipsResult> {
  const beats = script.beats ?? []
  if (!config.clipsEnabled || beats.length === 0) return EMPTY

  const maxBeats = Math.min(config.maxClipBeats ?? DEFAULT_MAX_CLIP_BEATS, beats.length)
  if (maxBeats <= 0) return EMPTY
  const cap = config.maxClipOnscreenSec ?? MAX_CLIP_ONSCREEN_SEC
  const downloadLen = Math.min(MAX_CLIP_DOWNLOAD_SEC, Math.max(4, cap + 2))
  const deadline = Date.now() + DEFAULT_CLIP_BUDGET_SEC * 1000

  const candidates = await gatherCandidates(brief, config, deps)
  if (!candidates.length) return EMPTY

  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })

  // Download up to maxBeats distinct-source clips, best-relevance first.
  const clips: { path: string; attribution: ClipAttribution; visual: VisualAsset }[] = []
  for (const cand of candidates) {
    if (clips.length >= maxBeats) break
    if (Date.now() > deadline) break
    // Distinct basename from assemble.ts's own clip-XX.mp4 / seg-XXX.mp4 render
    // artifacts so a source clip is never overwritten mid-render.
    const dest = path.join(dir, `srcclip-${String(clips.length).padStart(2, '0')}.mp4`)
    let ok = false
    try {
      ok = await cand.download(downloadLen, dest)
    } catch {
      ok = false
    }
    if (!ok) continue
    const attribution: ClipAttribution = {
      source: cand.source,
      title: cand.title,
      channel: cand.channel,
      url: cand.url,
    }
    const licenseRef = (cand.channel ? `${cand.title} — ${cand.channel}` : cand.title).slice(0, 140) + ` (${cand.url})`
    clips.push({
      path: dest,
      attribution,
      visual: {
        kind: 'video',
        source: cand.url,
        license: 'fair_use',
        depictsRealPerson: true,
        aiGenerated: false,
        licenseRef: licenseRef.slice(0, 200),
      },
    })
  }

  if (!clips.length) return EMPTY

  // Spread the resolved clips across the beats.
  const beatIdx = pickClipBeatIndices(
    beats.map((b) => b.index),
    clips.length
  )
  const beatClips: Record<number, string[]> = {}
  const visuals: VisualAsset[] = []
  clips.forEach((c, i) => {
    const bi = beatIdx[i]
    beatClips[bi] = [c.path]
    visuals.push({ ...c.visual, beatIndex: bi })
  })

  return { beatClips, attributions: clips.map((c) => c.attribution), visuals }
}
