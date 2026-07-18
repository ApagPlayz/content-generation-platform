// Unit tests for the paid-voice-failure classifier (src/lib/truecrime/tts.ts).
// Issue #57: when a PAID voice provider (ElevenLabs / OpenAI) is configured but
// its request fails, the app must notice and warn — but a provider the owner
// never configured (no API key) must NOT be treated as a failure. These are the
// two branches the whole feature turns on, so they're pinned here in isolation
// (no network / ffmpeg needed — the classifier is a pure function).

import { describe, expect, it } from 'vitest'
import { classifyPaidVoiceFailure } from './tts'

describe('classifyPaidVoiceFailure', () => {
  it('does NOT warn when the owner never configured the paid voice (no key)', () => {
    expect(classifyPaidVoiceFailure('elevenlabs', false, null)).toBeUndefined()
    // Even a non-ok response is irrelevant with no key — it was never really used.
    expect(classifyPaidVoiceFailure('elevenlabs', false, { ok: false, status: 401 })).toBeUndefined()
  })

  it('DOES warn when a configured key gets rejected (e.g. expired → 401)', () => {
    expect(classifyPaidVoiceFailure('elevenlabs', true, { ok: false, status: 401 })).toEqual({
      provider: 'elevenlabs',
      status: 401,
    })
  })

  it('warns with no status when the request threw (network error)', () => {
    expect(classifyPaidVoiceFailure('openai-tts', true, null)).toEqual({ provider: 'openai-tts' })
  })

  it('does NOT warn when a configured paid voice succeeds', () => {
    expect(classifyPaidVoiceFailure('openai-tts', true, { ok: true, status: 200 })).toBeUndefined()
  })
})
