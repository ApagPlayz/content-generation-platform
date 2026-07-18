// Unit tests for the narrated-pipeline finalize gate (src/lib/pipeline/finalize.ts).
// Issue #14: an empty render or a silent-stub voiceover must never be marked
// "done"/approved or auto-published. These pure helpers are the single source of
// truth both the True Crime and History orchestrators call, so they get tested
// here in isolation (mirroring the repo's colocated pure-function test style).

import { describe, expect, it } from 'vitest'
import {
  isEmptyRender,
  isSilentVoiceover,
  isPaidVoiceFallback,
  resolveFinalStatus,
  EMPTY_RENDER_ERROR,
  SILENT_VOICEOVER_REASON,
  paidVoiceFallbackReason,
} from './finalize'

describe('isEmptyRender', () => {
  it('is true when nothing was rendered', () => {
    expect(isEmptyRender({ rendered: false, outputPath: null })).toBe(true)
  })

  it('is true when rendered but there is no output path', () => {
    expect(isEmptyRender({ rendered: true, outputPath: null })).toBe(true)
    expect(isEmptyRender({ rendered: true, outputPath: '' })).toBe(true)
  })

  it('is true for a missing render result', () => {
    expect(isEmptyRender(null)).toBe(true)
    expect(isEmptyRender(undefined)).toBe(true)
  })

  it('is false for a real render', () => {
    expect(isEmptyRender({ rendered: true, outputPath: '/tmp/final.mp4' })).toBe(false)
  })
})

describe('isSilentVoiceover', () => {
  it('is true only for the silent-stub fallback provider', () => {
    expect(isSilentVoiceover('silent-stub')).toBe(true)
  })

  it('is false for a real voice provider or missing value', () => {
    expect(isSilentVoiceover('elevenlabs')).toBe(false)
    expect(isSilentVoiceover('openai-tts')).toBe(false)
    expect(isSilentVoiceover(undefined)).toBe(false)
    expect(isSilentVoiceover(null)).toBe(false)
  })
})

describe('isPaidVoiceFallback', () => {
  it('is true when a configured paid voice failed and a cheaper voice shipped', () => {
    expect(isPaidVoiceFallback({ provider: 'elevenlabs', status: 401 }, 'kokoro')).toBe(true)
    expect(isPaidVoiceFallback({ provider: 'openai-tts' }, 'macos-say')).toBe(true)
  })

  it('is false when no paid provider failed (benign "no key set")', () => {
    expect(isPaidVoiceFallback(undefined, 'kokoro')).toBe(false)
    expect(isPaidVoiceFallback(null, 'elevenlabs')).toBe(false)
  })

  it('is false for a silent stub — that is reported separately with a stronger reason', () => {
    expect(isPaidVoiceFallback({ provider: 'elevenlabs', status: 429 }, 'silent-stub')).toBe(false)
  })
})

describe('resolveFinalStatus', () => {
  it('publishes (approved) a clean auto run with real audio', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'pass', autonomy: 'auto', silentVoiceover: false }),
    ).toBe('approved')
  })

  it('forces review — never auto-publish — when a paid voice failed and fell back', () => {
    expect(
      resolveFinalStatus({
        complianceDecision: 'pass',
        autonomy: 'auto',
        silentVoiceover: false,
        paidVoiceFallback: true,
      }),
    ).toBe('review')
  })

  it('keeps review-mode agents in review even when clean', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'pass', autonomy: 'review', silentVoiceover: false }),
    ).toBe('review')
  })

  it('forces review when compliance routed to review', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'route_to_review', autonomy: 'auto', silentVoiceover: false }),
    ).toBe('review')
  })

  it('forces review — never auto-publish — when the voiceover was silent', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'pass', autonomy: 'auto', silentVoiceover: true }),
    ).toBe('review')
  })
})

describe('owner-facing reason strings', () => {
  it('explain both failure modes in plain English', () => {
    expect(EMPTY_RENDER_ERROR).toMatch(/no video file/i)
    expect(SILENT_VOICEOVER_REASON).toMatch(/no voiceover/i)
  })
})

describe('paidVoiceFallbackReason', () => {
  it('names the paid provider and the free voice used, in plain English', () => {
    const reason = paidVoiceFallbackReason({ provider: 'elevenlabs', status: 401 }, 'kokoro')
    expect(reason).toMatch(/ElevenLabs/)
    expect(reason).toMatch(/kokoro/)
    expect(reason).toMatch(/review/i)
  })

  it('translates the HTTP status into a likely cause', () => {
    expect(paidVoiceFallbackReason({ provider: 'elevenlabs', status: 401 }, 'kokoro')).toMatch(
      /expired or invalid/i,
    )
    expect(paidVoiceFallbackReason({ provider: 'openai-tts', status: 402 }, 'kokoro')).toMatch(
      /out of credits/i,
    )
    expect(paidVoiceFallbackReason({ provider: 'openai-tts', status: 429 }, 'kokoro')).toMatch(
      /rate limit/i,
    )
    expect(paidVoiceFallbackReason({ provider: 'elevenlabs' }, 'kokoro')).toMatch(/request failed/i)
  })
})
