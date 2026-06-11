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
  assembled?: AssembleResult
}

export const PIPELINE_STAGES = [
  'source',
  'clip-ingest',
  'moment-detect',
  'script',
  'assemble',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]
