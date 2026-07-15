// F10 True Crime pipeline contracts. The pipeline drives: discover → script →
// visuals → compliance gate → tts → captions → assemble. It shares the hub's
// Prisma models and the compliance layer (src/lib/compliance). Each stage is a
// Job row so the queue UI shows per-stage progress, mirroring the F9 sports
// orchestrator.

import type { CaseSubject, TrueCrimeScript, VisualAsset } from '../compliance'

/**
 * An engineered opening hook. Fires three layers in the first ~3s: a calm
 * spoken line (`verbal`), a compressed on-screen overlay (`onscreenText`, ≤7
 * words, never a copy of the verbal line), and an opening shot (`visualCue`).
 * `opensLoop` is the curiosity gap it raises; `payoffRef` names the beat that
 * closes it (enforced so we never promise a payoff the script can't deliver).
 */
export type HookType =
  | 'open_loop'
  | 'statistic'
  | 'question'
  | 'in_media_res'
  | 'contradiction'
  | 'overlooked_detail'
  | 'timeline'
  | 'unresolved_mystery'

export interface HookCandidate {
  type: HookType
  verbal: string
  onscreenText: string
  visualCue: string
  opensLoop: string
  payoffRef?: string
}

/**
 * One beat of the dramatic arc. Beats link with "but"/"therefore" (causal, not
 * sequential) and the climax lands at ~75–85% of runtime. The visual/pacing
 * fields (`visualCue`, `cutIntervalSec`, `musicIntensity`, `captionEmphasisWord`)
 * are planning hints consumed by the footage + render phases. `sourceAttribution`
 * is required on any beat carrying a contested claim about a non-convicted person.
 */
export interface ScriptBeat {
  name: string
  index: number
  narration: string
  targetSeconds: number
  /** Required on every beat after the hook; never "and then". */
  linkWord?: 'but' | 'therefore'
  visualCue: string
  cutIntervalSec: number
  musicIntensity: number
  captionEmphasisWord?: string
  sourceAttribution?: string
  complianceFlag: 'factual' | 'attributed' | 'opinion-clear'
}

/** A TrueCrimeScript plus the publish metadata the Video row needs and the
 *  beat-structured plan (hook + beats) that drives pacing and footage. */
export interface F10Script extends TrueCrimeScript {
  title: string
  description: string
  hashtags: string[]
  hook?: HookCandidate
  beats?: ScriptBeat[]
}

export const F10_STAGES = [
  'discover',
  'script',
  'footage',
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

  // ── Footage / visuals surface (all optional; every feature OFF by default so
  //    the existing Wikimedia-image slideshow stays the behaviour until opted in).
  //    Pre-declared here so downstream footage/stock/AI-still workstreams can read
  //    them without re-editing this shared file.

  /** Master switch for the per-beat footage stage. Default false. */
  footageEnabled?: boolean
  /** Per-beat cap on sourced video clips. Default small (e.g. 2). */
  maxClipsPerBeat?: number
  /** Per-beat cap on sourced still images. */
  maxImagesPerBeat?: number

  /** Opt in to the Claude AI script writer; falls back to the template. Default false. */
  useAiScript?: boolean

  /** Opt in to Pexels/Pixabay stock video footage. Default false. */
  useStockFootage?: boolean
  /** Per-beat cap on stock clips. Default 1. */
  maxStockClipsPerBeat?: number
  /** Ordered stock providers to try (e.g. ['pexels','pixabay']). Default ['pexels','pixabay']. */
  stockProviders?: string[]

  /** Opt in to archive.org public-domain footage. Default false. */
  useArchiveFootage?: boolean
  /** Cap on archive.org candidate clips searched per beat. Default 5. */
  archiveMaxClips?: number
  /** archive.org collections to search (e.g. ['prelinger']). */
  archiveCollections?: string[]
  /** Media-richness floor at DISCOVERY (round 6): minimum distinct archive.org
   *  movie/image hits a case/topic must have before it is accepted; poorer
   *  candidates are skipped for the next watchlist entry (an 1637/1720/1882
   *  story with no era footage makes a bad video no matter what the pipeline
   *  does downstream). Default 8 (DEFAULT_MIN_ARCHIVE_HITS in caseDiscovery);
   *  set 0 to disable the gate. */
  minArchiveHits?: number
  /** Era floor at DISCOVERY (round 6): a story whose Wikipedia-extracted year
   *  is BEFORE this is skipped — pre-1900 topics predate photography/newsreels
   *  and cannot be illustrated with real era footage no matter how many
   *  word-overlap search hits they get. Default 1900 (DEFAULT_MIN_TOPIC_YEAR);
   *  set 0 to disable. Stories with no detectable year pass this check and are
   *  judged on media richness alone. */
  minTopicYear?: number

  /** AI image model id (e.g. 'gpt-image-1'). */
  aiImageModel?: string
  /** AI still provider override ('openai' | 'stability' | 'local'). */
  aiStillProvider?: string
  /** Style suffix appended to every AI still prompt. */
  aiStillStyle?: string

  /** Ordered fallback ladder of footage sources (keyless-safe order by default). */
  footageLadder?: string[]
  /** Named visual styles rotated across videos for variation. */
  styleRotation?: string[]
  /** Editorial angles rotated to avoid "inauthentic content" sameness. */
  editorialAngles?: string[]
  /** How many recent videos to look back over when diverging style. */
  styleDivergenceWindow?: number
  /** Enable the editorial-angle layer. Default true. */
  enableEditorialLayer?: boolean
  /** Enable the mood-bank b-roll layer/tier. Default true (enabled); set false to skip it. */
  moodBankEnabled?: boolean
}

/**
 * One rendered segment on the beat timeline. Durations are seconds-based (the
 * single source of truth) so both render engines (ffmpeg + Remotion) derive
 * identical cut timing without drifting against the narration audio.
 */
export interface TimelineSegment {
  beatIndex: number
  startSec: number
  durationSec: number
  assetPath: string
  kind: 'video' | 'image'
  /** Trim start into a source video clip (seconds); ignored for images. */
  inSec?: number
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
  /** Per-run cost cap (USD) from Agent.budget; null/undefined means no cap. */
  budget?: number | null
  brief?: CaseBrief
  script?: F10Script
  visuals?: VisualAsset[]
  /** Local file paths of downloaded images, parallel to `visuals`. */
  imagePaths?: string[]
  /** Resolved footage paths per beat index; consumed by the assemble timeline. */
  beatFootage?: Record<number, string[]>
  complianceDecision?: 'pass' | 'route_to_review' | 'block'
  tts?: TtsResult
  captions?: CaptionsResult
  render?: RenderResult
}
