import { describe, expect, it } from 'vitest'
import {
  AUTO_PUBLISH_DISABLED,
  AUTO_PUBLISH_REVIEW_GATED,
  isAutoPublishFailure,
} from './publish'

// Guards the "tell the owner WHY a video didn't post" behaviour: only genuine,
// actionable problems get recorded + surfaced red on the dashboard. Expected
// opt-out states (review mode, auto-publish switched off) must stay quiet so the
// owner isn't shown a scary "Not posted" on every video for a setting he chose.
describe('isAutoPublishFailure', () => {
  it('treats expected opt-out states as non-failures (no red "Not posted")', () => {
    expect(isAutoPublishFailure(AUTO_PUBLISH_REVIEW_GATED)).toBe(false)
    expect(isAutoPublishFailure(AUTO_PUBLISH_DISABLED)).toBe(false)
  })

  it('treats actionable problems as failures worth surfacing', () => {
    expect(isAutoPublishFailure('YouTube not connected')).toBe(true)
    expect(isAutoPublishFailure('daily upload quota reached (6/day)')).toBe(true)
    expect(isAutoPublishFailure('YouTube did not return a video id')).toBe(true)
    expect(
      isAutoPublishFailure(
        'Rendered MP4 not found for this video — render it before publishing.'
      )
    ).toBe(true)
  })

  it('uses the exact opt-out strings computeAutoPublish returns', () => {
    // These constants are the reasons the gate returns; if they drift out of
    // sync the classifier would start flagging opt-out states as failures.
    expect(AUTO_PUBLISH_REVIEW_GATED).toBe('agent is review-gated')
    expect(AUTO_PUBLISH_DISABLED).toBe('auto-publish disabled in Settings')
  })
})
