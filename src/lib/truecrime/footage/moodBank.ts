// Mood-bank tier adapter. Thin wrapper over ../moodBank's selectMoodClips +
// pickLeastUsedClip + extractMoodStill. Keyless and networkless — reads
// whatever CC0/PD atmosphere clips the owner has populated under
// assets/mood-bank/, maps the beat's cue to a category, and poster-frames the
// chosen clip into a beat-indexed still. Empty bank → selectMoodClips returns
// [] → this tier returns null and the ladder falls through to the Wikimedia
// floor.
//
// Round-4 additions:
// - ERA AWARENESS: a story set before VINTAGE_CUTOFF_YEAR excludes the
//   ANACHRONISTIC_MOOD_CATEGORIES (modern police cars, neon cityscapes,
//   motorway traffic) — a history video misses to the era-appropriate
//   Wikimedia floor rather than showing a present-day squad car.
// - PER-VIDEO DIVERSITY: candidates are picked least-used-first via the shared
//   `moodUsage` map, so one clip never papers two beats of the same video
//   while another eligible clip sits unused.

import { existsSync } from 'fs'
import {
  ANACHRONISTIC_MOOD_CATEGORIES,
  extractMoodStill,
  pickLeastUsedClip,
  selectMoodClips,
  VINTAGE_CUTOFF_YEAR,
} from '../moodBank'
import type { Tier } from '../footage'

// Enough candidates for least-used to matter once the owner populates more of
// the bank; today's populated inventory is small so this is a safe over-ask.
const CANDIDATE_POOL_SIZE = 8

export const moodBankTier: Tier = async ({ beat, beatIndex, dest, brief, moodUsage, slot }) => {
  try {
    const vintage = brief.year != null && brief.year < VINTAGE_CUTOFF_YEAR
    const exclude = vintage ? ANACHRONISTIC_MOOD_CATEGORIES : []
    // Vintage stories (round 8): mood clips only on a DIRECT cue match, never
    // via fallback, and never a climate/style-mismatched clip — an unmatched
    // beat falls to the era-appropriate Wikimedia placeholder floor instead.
    const clips = await selectMoodClips(beat.visualCue || '', CANDIDATE_POOL_SIZE, beatIndex, exclude, vintage)
    const clip = moodUsage ? pickLeastUsedClip(clips, moodUsage) : clips[0]
    if (!clip || !clip.path) return null

    // Fold the slot into the seek variation so that when this tier fills BOTH
    // slots of one beat with the same clip, the two stills grab different
    // frames (beatIndex*2+slot is unique per (beat, slot) pair).
    const variation = beatIndex * 2 + (slot ?? 0)
    const still = await extractMoodStill(clip.path, dest, variation)
    if (!still || !existsSync(still)) return null

    moodUsage?.set(clip.path, (moodUsage.get(clip.path) ?? 0) + 1)
    return { imagePath: still, asset: { ...clip.asset, beatIndex } }
  } catch {
    return null
  }
}
