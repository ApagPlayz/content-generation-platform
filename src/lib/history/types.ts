// F11 History/Business-story pipeline contracts. F11 clones the F10 True Crime
// pipeline shape (same 8 stages, same Job-per-stage queue integration) and
// REUSES F10's generic stage modules by import — footage, visuals, tts,
// captions, assemble. Only discovery + scripting are factory-specific, so the
// types here mirror src/lib/truecrime/types.ts and stay wire-compatible with
// the shared stages: the discover output is a CaseBrief (caseName = topicName)
// and the script output is an F10Script, which keeps the compliance gate and
// every downstream stage working unchanged.

import type { CaseSubject } from '../compliance'
import type { CaseBrief, F10FactoryConfig, F10Script } from '../truecrime/types'

/**
 * An operator-curated history/business topic — the F11 analogue of F10's
 * CuratedCase. The operator still declares subject metadata (role / living /
 * minor) because the shared compliance gate's hard safety rules (minors,
 * living-person defamation lint) apply to every factory.
 */
export interface CuratedTopic {
  topicName: string
  /** Wikipedia article title; derived by search from topicName if omitted. */
  wikipediaTitle?: string
  /** Optional operator angle to keep videos varied (anti-"inauthentic content"). */
  angle?: string
  /** Optional era label (e.g. "dot-com boom", "Gilded Age") for framing. */
  era?: string
  subjects: CaseSubject[]
}

/**
 * F11 factory config — everything F10's config offers (footage ladder, TTS
 * voice, AI-script opt-in, style rotation…) plus the curated topic watchlist.
 * `caseWatchlist` is inherited but unused by F11; `topicWatchlist` drives it.
 */
export interface F11FactoryConfig extends F10FactoryConfig {
  /** Curated topics rotated through, one per run (deterministic by day). */
  topicWatchlist?: CuratedTopic[]
}

/** Same stage order as F10 — this ordering is an orchestrator INVARIANT:
 *  discover → script → footage → visuals → compliance → tts → captions →
 *  assemble. The visuals stage merges ALL imagery onto ctx.script.visuals
 *  BEFORE compliance so the gate lints the real imagery. Never reorder. */
export const F11_STAGES = [
  'discover',
  'script',
  'footage',
  'visuals',
  'compliance',
  'tts',
  'captions',
  'assemble',
] as const
export type F11Stage = (typeof F11_STAGES)[number]

/** Output of the F11 discover stage. Type-identical to F10's CaseBrief
 *  (caseName carries the topicName) so the shared footage/visuals stages and
 *  the compliance gate consume it without adapters. */
export type TopicBrief = CaseBrief

/** F11 scripts are shape-identical to F10 scripts (hook + beats + publish
 *  metadata) so the footage/captions/assemble stages reuse them unchanged. */
export type F11Script = F10Script

/** Mirrors F10Context — same fields, same stage-to-stage flow. */
export interface F11Context {
  videoId: string
  agentId: string
  runId: string
  config: F11FactoryConfig
  playbook: string
  brief?: TopicBrief
  script?: F11Script
  visuals?: import('../compliance').VisualAsset[]
  /** Local file paths of downloaded images, parallel to `visuals`. */
  imagePaths?: string[]
  /** Resolved footage paths per beat index; consumed by the assemble timeline. */
  beatFootage?: Record<number, string[]>
  /** Relevant moving clips resolved per beat index (paths to trimmed, muted
   *  .mp4 excerpts). Merged with the photo backbone into the render timeline. */
  beatClips?: Record<number, string[]>
  /** Attribution records for every sourced clip (title/channel/url). */
  clipAttributions?: import('../truecrime/types').ClipAttribution[]
  complianceDecision?: 'pass' | 'route_to_review' | 'block'
  tts?: import('../truecrime/types').TtsResult
  captions?: import('../truecrime/types').CaptionsResult
  render?: import('../truecrime/types').RenderResult
}
