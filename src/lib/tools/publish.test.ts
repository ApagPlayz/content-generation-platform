import { beforeEach, describe, expect, it, vi } from 'vitest'

// Publish-path safety tests below need the DB + platform SDKs mocked. The pure
// arithmetic tests further down don't touch these, so the mocks are inert there.
const { insertMock } = vi.hoisted(() => ({ insertMock: vi.fn() }))

vi.mock('../prisma', () => ({
  prisma: {
    video: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    post: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), count: vi.fn() },
    setting: { findUnique: vi.fn() },
    complianceReport: { findFirst: vi.fn() },
    costLedger: { create: vi.fn() },
  },
}))
vi.mock('../youtube', () => ({
  authedClient: vi.fn().mockResolvedValue({}),
  connection: vi.fn(),
  isAuthError: vi.fn(() => false),
  markNeedsReconnect: vi.fn(),
  PLATFORM: 'youtube',
  YT_RECONNECT_MESSAGE: 'reconnect',
}))
vi.mock('../tiktok', () => ({
  connection: vi.fn(),
  directPost: vi.fn(),
  PLATFORM: 'tiktok',
  tiktokPermalink: vi.fn(() => 'https://www.tiktok.com/@x/video/1'),
}))
vi.mock('../meta', () => ({
  connection: vi.fn(),
  publishReel: vi.fn(),
  isAuthError: vi.fn(() => false),
  markNeedsReconnect: vi.fn(),
  PLATFORM: 'facebook',
  facebookReelPermalink: vi.fn(() => 'https://www.facebook.com/reel/1'),
  FACEBOOK_RECONNECT_MESSAGE: 'reconnect',
}))
vi.mock('../settings', () => ({
  autoPublishEnabled: vi.fn(),
  tiktokAutoPublishEnabled: vi.fn(),
  facebookAutoPublishEnabled: vi.fn(),
}))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  createReadStream: vi.fn(() => 'STREAM'),
}))
vi.mock('googleapis', () => ({
  google: { youtube: vi.fn(() => ({ videos: { insert: insertMock } })) },
}))

import { prisma } from '../prisma'
import { connection as ytConnection } from '../youtube'
import { directPost } from '../tiktok'
import {
  AUTO_PUBLISH_DISABLED,
  AUTO_PUBLISH_REVIEW_GATED,
  isAlreadyPublished,
  isAutoPublishFailure,
  maybeAutoPublish,
  publishToTikTok,
  publishToYouTube,
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

// ── Publish-path safety gates (pre-launch hardening) ──
//
// The publish tools are the last line before a video goes public. These lock two
// invariants: (1) a video that isn't 'approved' — above all a compliance-
// 'rejected' one — can NEVER be uploaded, on either platform; (2) YouTube's
// synthetic-media disclosure flag is driven by the compliance gate's plan.

const APPROVED_VIDEO = {
  id: 'v1',
  status: 'approved',
  localPath: '/tmp/v1.mp4',
  title: 'Case X',
  description: 'desc',
  hashtags: null,
  factory: { type: 'F10' },
}

/** Wire up the happy-path mocks for a YouTube upload of `video`, with the given
 *  compliance report (or null for "no report"). */
function primeYouTube(video: Record<string, unknown>, reportJson: string | null) {
  vi.mocked(prisma.video.findUniqueOrThrow).mockResolvedValue(video as never)
  vi.mocked(prisma.post.findUnique).mockResolvedValue(null as never)
  vi.mocked(ytConnection).mockResolvedValue({} as never)
  vi.mocked(prisma.setting.findUnique).mockResolvedValue(null as never) // cap + privacy fall back
  vi.mocked(prisma.post.count).mockResolvedValue(0 as never) // full quota headroom
  vi.mocked(prisma.complianceReport.findFirst).mockResolvedValue(
    (reportJson === null ? null : { report: reportJson }) as never
  )
  vi.mocked(prisma.post.upsert).mockResolvedValue({ id: 'post1' } as never)
  vi.mocked(prisma.post.update).mockResolvedValue({ id: 'post1' } as never)
  vi.mocked(prisma.video.update).mockResolvedValue({} as never)
  vi.mocked(prisma.costLedger.create).mockResolvedValue({} as never)
  insertMock.mockResolvedValue({ data: { id: 'ytABC' } })
}

function insertedStatus(): Record<string, unknown> {
  const call = insertMock.mock.calls[0][0] as { requestBody: { status: Record<string, unknown> } }
  return call.requestBody.status
}

describe('publish status gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses to publish a compliance-rejected video to YouTube (never reaches the upload)', async () => {
    vi.mocked(prisma.video.findUniqueOrThrow).mockResolvedValue({
      ...APPROVED_VIDEO,
      status: 'rejected',
    } as never)
    vi.mocked(prisma.post.findUnique).mockResolvedValue(null as never)

    await expect(publishToYouTube('v1')).rejects.toThrow(/only approved videos can be published/)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'failed', 'draft', 'queued', 'review'])(
    'refuses to publish a "%s" video to YouTube',
    async (status) => {
      vi.mocked(prisma.video.findUniqueOrThrow).mockResolvedValue({
        ...APPROVED_VIDEO,
        status,
      } as never)
      vi.mocked(prisma.post.findUnique).mockResolvedValue(null as never)
      await expect(publishToYouTube('v1')).rejects.toThrow(/only approved/)
      expect(insertMock).not.toHaveBeenCalled()
    }
  )

  it('refuses to publish a compliance-rejected video to TikTok', async () => {
    vi.mocked(prisma.video.findUniqueOrThrow).mockResolvedValue({
      ...APPROVED_VIDEO,
      status: 'rejected',
    } as never)
    vi.mocked(prisma.post.findUnique).mockResolvedValue(null as never)

    await expect(publishToTikTok('v1')).rejects.toThrow(/only approved videos can be published/)
    expect(directPost).not.toHaveBeenCalled()
  })

  it('allows an approved video through to the YouTube upload', async () => {
    primeYouTube(
      APPROVED_VIDEO,
      JSON.stringify({ disclosure: { requiresAiVisualLabel: false, requiresAiAudioLabel: false } })
    )
    const res = await publishToYouTube('v1')
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(res.platformPostId).toBe('ytABC')
  })
})

describe('publish AI-disclosure flag (containsSyntheticMedia)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets containsSyntheticMedia=true when the plan requires an AI visual label', async () => {
    primeYouTube(
      APPROVED_VIDEO,
      JSON.stringify({ disclosure: { requiresAiVisualLabel: true, requiresAiAudioLabel: false } })
    )
    await publishToYouTube('v1')
    expect(insertedStatus().containsSyntheticMedia).toBe(true)
  })

  it('sets containsSyntheticMedia=true when only the AI audio label is required', async () => {
    primeYouTube(
      APPROVED_VIDEO,
      JSON.stringify({ disclosure: { requiresAiVisualLabel: false, requiresAiAudioLabel: true } })
    )
    await publishToYouTube('v1')
    expect(insertedStatus().containsSyntheticMedia).toBe(true)
  })

  it('sets containsSyntheticMedia=false when a report exists and needs no labels', async () => {
    primeYouTube(
      APPROVED_VIDEO,
      JSON.stringify({ disclosure: { requiresAiVisualLabel: false, requiresAiAudioLabel: false } })
    )
    await publishToYouTube('v1')
    expect(insertedStatus().containsSyntheticMedia).toBe(false)
  })

  it('falls back to false and warns when a gated-factory video has no report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    primeYouTube(APPROVED_VIDEO, null)
    await publishToYouTube('v1')
    expect(insertedStatus().containsSyntheticMedia).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No ComplianceReport'))
    warn.mockRestore()
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
