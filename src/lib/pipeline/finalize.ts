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
 * True when the finished video is meaningfully SHORTER than the narration it
 * should carry — e.g. some slideshow stills failed to render and the final
 * `-shortest` mux clipped the voice off mid-story (issue #94). SOFT failure:
 * keep the video but force review, never auto-publish a cut-off clip.
 *
 * `measuredSec` is the ffprobe-measured output duration; `intendedSec` the
 * narration (audio) length. When the measurement is unknown (null/NaN/<=0 —
 * e.g. ffprobe unavailable) we return false, so a build that can't measure keeps
 * today's behaviour instead of false-flagging every render. `toleranceSec`
 * absorbs normal encoder/keyframe rounding so a full-length render isn't held.
 */
export function isTruncatedRender(input: {
  measuredSec: number | null | undefined
  intendedSec: number | null | undefined
  toleranceSec?: number
}): boolean {
  const { measuredSec, intendedSec } = input
  const tol = input.toleranceSec ?? 1.5
  if (measuredSec == null || !Number.isFinite(measuredSec) || measuredSec <= 0) return false
  if (intendedSec == null || !Number.isFinite(intendedSec) || intendedSec <= 0) return false
  return measuredSec < intendedSec - tol
}

/**
 * The free / on-device voices. When a PAID voice fails and we land on one of
 * these, the owner is paying for a premium voice they didn't get (issue #57).
 * `silent-stub` is deliberately NOT here — a silent voiceover is the more
 * serious flag handled by isSilentVoiceover, so we never double-flag it.
 */
const FREE_LOCAL_VOICES = new Set(['kokoro', 'macos-say'])

/** A paid voice attempt that failed with an API key present. */
export interface PaidVoiceFailure {
  provider: string
  detail: string
}

/** The resolved "paid → free" downgrade, ready to surface to the owner. */
export interface PaidVoiceFallbackInfo {
  failedProvider: string
  usedProvider: string
  detail: string
}

/**
 * Decide whether a video silently downgraded from a paid voice to a free/local
 * one. Returns the fallback details, or null when there's nothing to surface:
 *   • no paid provider failed with a key present (`paidFailures` empty — this is
 *     also the "no key set" case, which never records a failure), OR
 *   • a paid voice still narrated the video (`usedProvider` isn't free/local), OR
 *   • the voiceover was silent (silent-stub) — covered by isSilentVoiceover.
 * When several paid providers failed we report the first (the one the owner's
 * preferred provider was tried as).
 */
export function resolvePaidVoiceFallback(input: {
  paidFailures: PaidVoiceFailure[]
  usedProvider: string | null | undefined
}): PaidVoiceFallbackInfo | null {
  const { paidFailures, usedProvider } = input
  if (!paidFailures.length) return null
  if (!usedProvider || !FREE_LOCAL_VOICES.has(usedProvider)) return null
  const first = paidFailures[0]
  return { failedProvider: first.provider, usedProvider, detail: first.detail }
}

/** True when a paid voice failed and the video fell back to a free voice. */
export function isPaidVoiceFallback(info: PaidVoiceFallbackInfo | null | undefined): boolean {
  return !!info
}

const PAID_VOICE_LABEL: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  'openai-tts': 'OpenAI',
}
const FREE_VOICE_LABEL: Record<string, string> = {
  kokoro: 'free Kokoro',
  'macos-say': 'free built-in Mac',
}

/**
 * Plain-English reason shown to the owner when a paid voice failed and the video
 * fell back to a free voice. Names the account to check so the fix is obvious.
 */
export function paidVoiceFallbackReason(info: PaidVoiceFallbackInfo): string {
  const paid = PAID_VOICE_LABEL[info.failedProvider] ?? info.failedProvider
  const free = FREE_VOICE_LABEL[info.usedProvider] ?? `free (${info.usedProvider})`
  return (
    `Your paid ${paid} voice failed (${info.detail}), so this video was narrated with the ${free} ` +
    `voice instead — held for review so it isn't published in the wrong voice. Check your ${paid} ` +
    `account (expired key, out of credits, or rate-limited).`
  )
}

/**
 * Decide a video's final status. A silent voiceover forces review (and so
 * blocks auto-publish, since only 'approved' publishes). Compliance's
 * route_to_review already did the same; this just adds the audio checks.
 */
export function resolveFinalStatus(input: {
  complianceDecision?: string
  autonomy: string
  silentVoiceover: boolean
  truncatedRender?: boolean
  paidVoiceFallback?: boolean
}): 'review' | 'approved' {
  if (input.complianceDecision === 'route_to_review') return 'review'
  if (input.silentVoiceover) return 'review'
  if (input.truncatedRender) return 'review'
  if (input.paidVoiceFallback) return 'review'
  return input.autonomy === 'auto' ? 'approved' : 'review'
}

/** Plain-English reason shown to the owner when a render produces no file. */
export const EMPTY_RENDER_ERROR =
  'Assemble finished but produced no video file (ffmpeg unavailable or final.mp4 missing) — nothing was published.'

/** Plain-English reason shown to the owner when the voiceover was silent. */
export const SILENT_VOICEOVER_REASON =
  'No voiceover was produced (all voice providers failed) — held for review instead of publishing a silent video.'

/** Plain-English reason shown to the owner when the video came out too short. */
export const TRUNCATED_RENDER_REASON =
  'The finished video was shorter than the narration (some images failed to render), so the voiceover would be cut off — held for review instead of publishing a clipped video.'
