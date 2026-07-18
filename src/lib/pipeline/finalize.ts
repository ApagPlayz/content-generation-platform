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

/** Minimal shape of the paid-voice-failure signal the TTS stage attaches to its
 *  result. Kept structural so finalize doesn't depend on the pipeline types. */
export interface PaidVoiceFailureLike {
  provider: string
  status?: number
}

/**
 * True when a configured PAID voice provider failed and TTS fell back to a
 * cheaper/free voice — the video is usable but not in the voice the owner is
 * paying for, and their paid account may be broken. A fully silent voiceover is
 * reported separately with a stronger reason, so it takes precedence: this
 * returns false for the silent stub to avoid double-flagging the same run.
 */
export function isPaidVoiceFallback(
  failure: PaidVoiceFailureLike | null | undefined,
  usedProvider: string | null | undefined,
): boolean {
  return Boolean(failure) && usedProvider !== 'silent-stub'
}

/**
 * Decide a video's final status. A silent voiceover — or a paid voice that
 * failed and fell back to a cheaper one — forces review (and so blocks
 * auto-publish, since only 'approved' publishes). Compliance's route_to_review
 * already did the same; this just adds the audio checks.
 */
export function resolveFinalStatus(input: {
  complianceDecision?: string
  autonomy: string
  silentVoiceover: boolean
  paidVoiceFallback?: boolean
}): 'review' | 'approved' {
  if (input.complianceDecision === 'route_to_review') return 'review'
  if (input.silentVoiceover) return 'review'
  if (input.paidVoiceFallback) return 'review'
  return input.autonomy === 'auto' ? 'approved' : 'review'
}

/** Plain-English reason shown to the owner when a render produces no file. */
export const EMPTY_RENDER_ERROR =
  'Assemble finished but produced no video file (ffmpeg unavailable or final.mp4 missing) — nothing was published.'

/** Plain-English reason shown to the owner when the voiceover was silent. */
export const SILENT_VOICEOVER_REASON =
  'No voiceover was produced (all voice providers failed) — held for review instead of publishing a silent video.'

const PAID_PROVIDER_LABEL: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  'openai-tts': 'OpenAI',
}

/** Best-effort plain-English cause from the failed provider's HTTP status. */
function paidFailureCause(status?: number): string {
  if (status === 401 || status === 403) return 'the API key looks expired or invalid'
  if (status === 402) return 'the account is out of credits'
  if (status === 429) return "you've hit the provider's rate limit"
  return 'the request failed'
}

/**
 * Plain-English reason shown to the owner when a paid voice they picked failed
 * and a cheaper voice was used instead. Names the provider so they know which
 * account to check.
 */
export function paidVoiceFallbackReason(
  failure: PaidVoiceFailureLike,
  usedProvider: string,
): string {
  const label = PAID_PROVIDER_LABEL[failure.provider] ?? failure.provider
  return (
    `Your paid ${label} voice didn't work this time (${paidFailureCause(failure.status)}), so ` +
    `this video was narrated with the free "${usedProvider}" voice instead. Held for review so ` +
    `it isn't published in the wrong voice — check your ${label} account.`
  )
}
