// Unit tests for the narrated-pipeline finalize gate (src/lib/pipeline/finalize.ts).
// Issue #14: an empty render or a silent-stub voiceover must never be marked
// "done"/approved or auto-published. These pure helpers are the single source of
// truth both the True Crime and History orchestrators call, so they get tested
// here in isolation (mirroring the repo's colocated pure-function test style).

import { describe, expect, it } from 'vitest'
import {
  isEmptyRender,
  isSilentVoiceover,
  isTruncatedRender,
  resolveFinalStatus,
  EMPTY_RENDER_ERROR,
  SILENT_VOICEOVER_REASON,
  TRUNCATED_RENDER_REASON,
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

describe('isTruncatedRender', () => {
  it('flags a render well shorter than the narration', () => {
    expect(isTruncatedRender({ measuredSec: 40, intendedSec: 75 })).toBe(true)
  })

  it('passes a full-length render (with rounding slack)', () => {
    expect(isTruncatedRender({ measuredSec: 75, intendedSec: 75 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: 74.2, intendedSec: 75 })).toBe(false) // within 1.5s tolerance
    expect(isTruncatedRender({ measuredSec: 80, intendedSec: 75 })).toBe(false) // longer is fine
  })

  it('flags just past the tolerance boundary', () => {
    expect(isTruncatedRender({ measuredSec: 75 - 1.6, intendedSec: 75 })).toBe(true)
  })

  it('never flags when a value is unknown/zero (unmeasurable → ship)', () => {
    expect(isTruncatedRender({ measuredSec: null, intendedSec: 75 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: undefined, intendedSec: 75 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: 0, intendedSec: 75 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: Number.NaN, intendedSec: 75 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: 40, intendedSec: null })).toBe(false)
    expect(isTruncatedRender({ measuredSec: 40, intendedSec: 0 })).toBe(false)
  })

  it('honours a custom tolerance', () => {
    expect(isTruncatedRender({ measuredSec: 70, intendedSec: 75, toleranceSec: 10 })).toBe(false)
    expect(isTruncatedRender({ measuredSec: 70, intendedSec: 75, toleranceSec: 2 })).toBe(true)
  })
})

describe('resolveFinalStatus', () => {
  it('publishes (approved) a clean auto run with real audio', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'pass', autonomy: 'auto', silentVoiceover: false }),
    ).toBe('approved')
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

  it('forces review — never auto-publish — when the render was truncated', () => {
    expect(
      resolveFinalStatus({
        complianceDecision: 'pass',
        autonomy: 'auto',
        silentVoiceover: false,
        truncatedRender: true,
      }),
    ).toBe('review')
  })

  it('still approves a clean auto run when truncatedRender is omitted', () => {
    expect(
      resolveFinalStatus({ complianceDecision: 'pass', autonomy: 'auto', silentVoiceover: false }),
    ).toBe('approved')
  })
})

describe('owner-facing reason strings', () => {
  it('explain both failure modes in plain English', () => {
    expect(EMPTY_RENDER_ERROR).toMatch(/no video file/i)
    expect(SILENT_VOICEOVER_REASON).toMatch(/no voiceover/i)
  })

  it('explains a truncated render in plain English', () => {
    expect(TRUNCATED_RENDER_REASON).toMatch(/shorter than the narration/i)
  })
})
