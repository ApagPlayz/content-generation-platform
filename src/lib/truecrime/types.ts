// F10 True Crime pipeline contracts. The pipeline drives: discover → script →
// visuals → compliance gate → tts → captions → assemble. It shares the hub's
// Prisma models and the compliance layer (src/lib/compliance). Each stage is a
// Job row so the queue UI shows per-stage progress, mirroring the F9 sports
// orchestrator.

import type { CaseSubject, TrueCrimeScript, VisualAsset } from '../compliance'

/** A TrueCrimeScript plus the publish metadata the Video row needs. */
export interface F10Script extends TrueCrimeScript {
  title: string
  description: string
  hashtags: string[]
}

export const F10_STAGES = [
  'discover',
  'script',
  'visuals',
  'compliance',
  'tts',
  'captions',
  'assemble',
] as const
export type F10Stage = (typeof F10_STAGES)[number]

/**
 * An operator-curated case. The operator declares the legally-critical subject
 * metadata (role / living / minor) — this is the human-in-the-loop input the
 * compliance gate depends on. Discovery enriches it with Wikipedia/Wikidata
 * facts but never invents subjects.
 */
export interface CuratedCase {
  caseName: string
  /** Wikipedia article title; derived by search from caseName if omitted. */
  wikipediaTitle?: string
  subjects: CaseSubject[]
  /** Optional operator angle to keep videos varied (anti-"inauthentic content"). */
  angle?: string
}

export interface F10FactoryConfig {
  description?: string
  /** Claude tier for scripting: 'haiku' | 'sonnet' | 'opus' (or a model id). */
  scriptModel?: string
  /** Curated cases rotated through, one per run (deterministic by day). */
  caseWatchlist?: CuratedCase[]
  /** Target seconds — ≥60 for TikTok Creator Rewards eligibility. Default 75. */
  targetDurationSec?: number
  /** ElevenLabs voice id, or a macOS `say` voice name for the local fallback. */
  voice?: string
  /** Max public-domain images to source for the slideshow. Default 6. */
  maxImages?: number
}

/** Output of the discover stage — facts enriched onto a curated case. */
export interface CaseBrief {
  caseName: string
  wikipediaTitle: string
  wikipediaUrl: string
  summary: string
  /** Short factual bullets pulled from the article intro. */
  facts: string[]
  subjects: CaseSubject[]
  year?: number
  angle?: string
  /** Best-effort Wikidata living-status check; flags operator-flag mismatches. */
  livingWarnings: string[]
}

/** A single word with its spoken time window (seconds). */
export interface WordStamp {
  word: string
  startSec: number
  endSec: number
}

export interface TtsResult {
  audioPath: string
  durationSec: number
  provider: 'elevenlabs' | 'openai-tts' | 'kokoro' | 'macos-say' | 'silent-stub'
  /** Word-level timings when the provider supplies them (Kokoro captioned). */
  words?: WordStamp[]
}

/** One word inside a caption page, for word-by-word (karaoke) highlighting. */
export interface CaptionToken {
  text: string
  startSec: number
  endSec: number
}

export interface CaptionCue {
  text: string
  startSec: number
  endSec: number
  /** Per-word timings within this page; present when built from word stamps. */
  tokens?: CaptionToken[]
}

export interface CaptionsResult {
  cues: CaptionCue[]
  captionsPath: string
  method: 'kokoro' | 'whisper' | 'heuristic'
}

export interface RenderResult {
  outputPath: string | null
  durationSec: number
  rendered: boolean
  /** When ffmpeg is unavailable we emit a timeline plan instead of a video. */
  planPath?: string
}

export interface F10Context {
  videoId: string
  agentId: string
  runId: string
  config: F10FactoryConfig
  playbook: string
  brief?: CaseBrief
  script?: F10Script
  visuals?: VisualAsset[]
  /** Local file paths of downloaded images, parallel to `visuals`. */
  imagePaths?: string[]
  complianceDecision?: 'pass' | 'route_to_review' | 'block'
  tts?: TtsResult
  captions?: CaptionsResult
  render?: RenderResult
}
