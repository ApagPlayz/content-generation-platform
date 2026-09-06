/**
 * The TikTok-only "long cut" (issue #77).
 *
 * TikTok's Creator Rewards Program only pays out on ORIGINAL videos LONGER THAN
 * one minute. Our sports factory targets a ~20s highlight, so every TikTok post
 * is structurally locked out of earning no matter how well it does — this isn't
 * a new revenue channel, it's removing a hard eligibility blocker on a program
 * we already post into.
 *
 * The fix is a SECOND render that goes to TikTok alone: the same detected
 * moment, widened to ~65s of real surrounding footage. YouTube Shorts and Reels
 * keep the tight short cut (Video.localPath), which is what performs there.
 *
 * Pure module: no I/O, no Prisma, no ffmpeg — safe to unit test. The actual
 * second render lives in the orchestrator's assemble stage, and the "which file
 * does TikTok upload" decision lives in tools/publish.ts.
 */

/** Creator Rewards pays on videos LONGER THAN a minute — 60s exactly does not count. */
export const TIKTOK_REWARDS_MIN_SEC = 60

/** What we aim for: inside the issue's 65–70s band, comfortably over the floor. */
export const LONG_CUT_TARGET_SEC = 65

/**
 * The shortest cut we will actually ship to TikTok. A single second over the
 * payout floor is too tight — ffmpeg's `-ss` keyframe seek can land the real
 * file a beat short of what we asked for — so anything under this is discarded
 * rather than published as a "long cut" that silently doesn't qualify.
 */
export const LONG_CUT_FLOOR_SEC = 62

/** Filename of the second render, alongside the short cut's `final.mp4`. */
export const TIKTOK_CUT_FILENAME = 'final-tiktok.mp4'

/**
 * Asset.kind for the long cut. An Asset row (not a new Video column) keeps this
 * a zero-migration change and matches how the transform stage already records
 * its intermediate render.
 */
export const TIKTOK_CUT_ASSET_KIND = 'tiktok-cut'

export interface LongCutPlan {
  startSec: number
  endSec: number
  durationSec: number
}

/**
 * Widen the detected highlight window to `targetSec` of REAL surrounding
 * footage, centred on the moment and clamped inside the downloaded reel.
 *
 * Returns null when the reel simply cannot yield a qualifying cut — the honest
 * skip. We never pad, freeze, loop or slow-mo to reach a minute: the issue asks
 * for pacing, not filler, and a padded minute would still be a $0 post.
 */
export function planLongCut(
  moment: { startSec: number; endSec: number },
  sourceDurationSec: number,
  targetSec: number = LONG_CUT_TARGET_SEC,
  floorSec: number = LONG_CUT_FLOOR_SEC
): LongCutPlan | null {
  if (!Number.isFinite(sourceDurationSec)) return null
  const source = Math.floor(sourceDurationSec)
  const want = Math.min(Math.round(targetSec), source)
  // Neither the reel nor the requested target can reach the payout floor.
  if (want < floorSec) return null

  const centre = (moment.startSec + moment.endSec) / 2
  let start = Math.round(centre - want / 2)
  // Clamp the tail first, then the head: on a reel barely longer than `want`
  // the head clamp must win, or the window would run past the end of the file.
  if (start + want > source) start = source - want
  if (start < 0) start = 0
  return { startSec: start, endSec: start + want, durationSec: want }
}

/**
 * The issue's success criterion, checked against the file ffmpeg ACTUALLY
 * produced rather than the length we asked for. A cut that came out short is
 * not a TikTok cut — the caller drops it and TikTok gets the normal render.
 */
export function longCutIsUsable(
  actualDurationSec: number,
  floorSec: number = LONG_CUT_FLOOR_SEC
): boolean {
  return Number.isFinite(actualDurationSec) && actualDurationSec >= floorSec
}

/**
 * How much source footage clip-ingest must download for a long cut to be a
 * genuine CHOICE of footage rather than "the whole reel, necessarily".
 *
 * Load-bearing, not polish: clipIngest only pulls a 90s window by default, so
 * asking ffmpeg for 65s out of it would hand TikTok almost the entire reel.
 * Never returns less than the existing 90s default, so turning the feature off
 * changes nothing about what gets downloaded.
 */
export function longCutIngestWindowSec(
  configuredSec: number | undefined,
  targetSec: number = LONG_CUT_TARGET_SEC
): number {
  return Math.max(configuredSec ?? 0, 90, Math.round(targetSec) + 60)
}

/** Does a finished cut clear TikTok's payout floor? "Longer than", not "at least". */
export function qualifiesForTikTokRewards(durationSec?: number | null): boolean {
  return (
    typeof durationSec === 'number' &&
    Number.isFinite(durationSec) &&
    durationSec > TIKTOK_REWARDS_MIN_SEC
  )
}

/**
 * The plain-English answer to "will the TikTok version of this be able to
 * earn?", shown on the review card so the owner can see payout eligibility
 * BEFORE approving. Takes the length of the file TikTok will actually receive
 * (the long cut when one exists, otherwise the short render). Returns null when
 * the length is unknown and there is therefore nothing honest to claim.
 */
export function tiktokRewardsNote(tiktokCutSec?: number | null): string | null {
  if (typeof tiktokCutSec !== 'number' || !Number.isFinite(tiktokCutSec) || tiktokCutSec <= 0) {
    return null
  }
  const secs = Math.round(tiktokCutSec)
  return qualifiesForTikTokRewards(secs)
    ? `TikTok gets a ${secs}s cut — over a minute, so it can earn Creator Rewards.`
    : `TikTok gets a ${secs}s cut — under a minute, so this post can't earn Creator Rewards.`
}
