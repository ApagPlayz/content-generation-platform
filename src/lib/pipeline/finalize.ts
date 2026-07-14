// Shared "did this video actually come out OK?" gate for the narrated
// (True Crime + History) pipelines.
//
// Both orchestrators used to trust their render/TTS stages blindly: an empty
// render or a silent-stub voiceover still got marked "approved" and could be
// auto-published. These pure helpers centralise the two checks so both
// pipelines stay in sync, and are unit-tested in isolation.
//
// See issue #14: "stop marking broken or silent videos as done".

/** Shape of the render result the assemble stage produces. */
export interface RenderLike {
  outputPath?: string | null
  rendered?: boolean
}

/**
 * True when the assemble stage finished but produced no usable video file
 * (e.g. ffmpeg missing, or final.mp4 was never written). This is a HARD
 * failure — the caller should throw so the run is marked failed, never
 * "approved" and never published.
 */
export function isEmptyRender(render: RenderLike | null | undefined): boolean {
  return !render || !render.rendered || !render.outputPath
}

/**
 * True when TTS fell back to the silent stub — i.e. every real voice provider
 * failed and the video has no narration. This is a SOFT failure: we keep the
 * video but force it to review and refuse to auto-publish a voiceless clip.
 */
export function isSilentVoiceover(provider: string | null | undefined): boolean {
  return provider === 'silent-stub'
}

/**
 * Decide a video's final status. A silent voiceover forces review (and so
 * blocks auto-publish, since only 'approved' publishes). Compliance's
 * route_to_review already did the same; this just adds the audio check.
 */
export function resolveFinalStatus(input: {
  complianceDecision?: string
  autonomy: string
  silentVoiceover: boolean
}): 'review' | 'approved' {
  if (input.complianceDecision === 'route_to_review') return 'review'
  if (input.silentVoiceover) return 'review'
  return input.autonomy === 'auto' ? 'approved' : 'review'
}

/** Plain-English reason shown to the owner when a render produces no file. */
export const EMPTY_RENDER_ERROR =
  'Assemble finished but produced no video file (ffmpeg unavailable or final.mp4 missing) — nothing was published.'

/** Plain-English reason shown to the owner when the voiceover was silent. */
export const SILENT_VOICEOVER_REASON =
  'No voiceover was produced (all voice providers failed) — held for review instead of publishing a silent video.'
