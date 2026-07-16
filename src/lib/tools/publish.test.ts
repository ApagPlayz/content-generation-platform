import { describe, expect, it } from 'vitest'
import {
  AUTO_PUBLISH_DISABLED,
  AUTO_PUBLISH_REVIEW_GATED,
  isAlreadyPublished,
  isAutoPublishFailure,
  maybeAutoPublish,
  remainingQuota,
  startOfDayUTC,
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
    expect(
      isAutoPublishFailure(
        'YouTube disconnected — your login expired. Reconnect in Settings to resume publishing.'
      )
    ).toBe(true)
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

// Multi-platform fan-out (issue #19): review-gated agents must not touch ANY
// platform. This path returns before any DB/network call, so it's safe to assert
// without a database — and it guards the top-level gate that blocks TikTok as
// well as YouTube when a human hasn't approved the video.
describe('maybeAutoPublish gating', () => {
  it('never publishes to any platform when the agent is review-gated', async () => {
    const outcome = await maybeAutoPublish('any-video-id', 'review')
    expect(outcome).toEqual({ published: false, reason: AUTO_PUBLISH_REVIEW_GATED })
  })
})

// The daily-quota wall (issue #20): the pure arithmetic behind quotaStatus().
// An off-by-one here silently over-posts (past YouTube's ~6/day cap → throttled)
// or under-posts (leaves free slots on the table). The DB count is mocked out of
// scope on purpose — the arithmetic is what a slip breaks, so that's what's locked.
describe('remainingQuota', () => {
  it('reports the full cap on a fresh day', () => {
    expect(remainingQuota(0, 6)).toBe(6)
  })

  it('counts down as uploads are posted', () => {
    expect(remainingQuota(5, 6)).toBe(1)
  })

  it('reads exactly 0 when today has hit the cap (the quota wall)', () => {
    expect(remainingQuota(6, 6)).toBe(0)
  })

  it('clamps to 0 when somehow over the cap — never a negative that re-enables posting', () => {
    expect(remainingQuota(9, 6)).toBe(0)
  })
})

// The "published today" lower bound (issue #20): a timezone slip in this
// day-boundary math would count yesterday's or tomorrow's posts, silently over-
// or under-counting against the cap. Injecting `now` makes it deterministic.
describe('startOfDayUTC', () => {
  it('returns UTC midnight of the given instant', () => {
    expect(startOfDayUTC(new Date('2026-07-15T13:45:30.500Z')).toISOString()).toBe(
      '2026-07-15T00:00:00.000Z'
    )
  })

  it('keeps the same UTC day for a time just before midnight', () => {
    expect(startOfDayUTC(new Date('2026-07-15T23:59:59.999Z')).toISOString()).toBe(
      '2026-07-15T00:00:00.000Z'
    )
  })

  it('is already at the boundary at 00:00:00 UTC', () => {
    expect(startOfDayUTC(new Date('2026-07-15T00:00:00.000Z')).toISOString()).toBe(
      '2026-07-15T00:00:00.000Z'
    )
  })
})

// Publish idempotency (issue #20): the shared decision that stops a video being
// posted to the same platform twice. It must fire ONLY on a genuinely-live post
// (status 'published' AND a real platform id) — a mid-upload, a failure, or a
// published row missing its id must all still allow the (re)upload to proceed.
describe('isAlreadyPublished', () => {
  it('is false when there is no prior post', () => {
    expect(isAlreadyPublished(null)).toBe(false)
    expect(isAlreadyPublished(undefined)).toBe(false)
  })

  it('is false mid-upload (publishing) so a crash can retry', () => {
    expect(isAlreadyPublished({ status: 'publishing', platformPostId: null })).toBe(false)
  })

  it('is false after a failed attempt so it will retry', () => {
    expect(isAlreadyPublished({ status: 'failed', platformPostId: 'yt123' })).toBe(false)
  })

  it('is false when marked published but carrying no platform id', () => {
    expect(isAlreadyPublished({ status: 'published', platformPostId: null })).toBe(false)
  })

  it('is true only when published AND holding a real platform id (blocks re-upload)', () => {
    expect(isAlreadyPublished({ status: 'published', platformPostId: 'yt123' })).toBe(true)
  })
})
