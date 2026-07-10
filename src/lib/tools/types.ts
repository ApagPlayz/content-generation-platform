// Shared tool-belt contracts. Every pipeline stage is a Tool that takes the
// run context, does its work, and returns updated context. Stages are recorded
// as Job rows by the orchestrator so the queue UI can show per-stage progress.

export type SportsStrategy = 'trending_game' | 'player_career' | 'trending_audio'

export interface SourceResult {
  strategy: SportsStrategy
  /** Why this was picked — shown in review inbox and fed to the script tool. */
  triggerReason: string
  /** Search query used to find the source highlight reel on YouTube. */
  youtubeQuery: string
  /** Raw trigger payload (game, player, audio ref) persisted to HighlightSource. */
  sourceData: Record<string, unknown>
}

export interface IngestResult {
  /** Local path of the downloaded source reel. */
  sourcePath: string
  youtubeUrl: string
  durationSec: number
}

export interface MomentResult {
  startSec: number
  endSec: number
  method: 'audio_energy' | 'fixed_window'
}

export interface ScriptResult {
  title: string
  hook: string
  description: string
  hashtags: string[]
  /** Short original analytical/commentary lines burned as timed overlays by the
   *  transform stage (the transformative commentary). Optional — empty when the
   *  model/template doesn't supply any. */
  analysis?: string[]
  /** Optional on-screen callouts for telestration (spotlight + label). */
  telestration?: { label: string; atSec?: number }[]
}

/** Output of the transform stage: a treated clip with edit + overlays burned in. */
export interface TransformResult {
  /** Local path of the treated clip the assemble stage should consume. */
  treatedPath: string
  /** Duration of the treated clip in seconds (may differ from the raw window
   *  when slow-mo was applied) — thread this to assemble, don't assume. */
  durationSec: number
  /** Human-readable list of treatments actually applied (e.g. 'punch-in'). */
  treatments: string[]
  telestrationCount: number
  analysisLines: number
}

export interface AssembleResult {
  outputPath: string
  durationSec: number
}

export interface ToolContext {
  videoId: string
  agentId: string
  runId: string
  factoryConfig: Record<string, unknown>
  playbook: string
  source?: SourceResult
  ingest?: IngestResult
  moment?: MomentResult
  script?: ScriptResult
  transform?: TransformResult
  assembled?: AssembleResult
}

export const PIPELINE_STAGES = [
  'source',
  'clip-ingest',
  'moment-detect',
  'script',
  'transform',
  'assemble',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]
