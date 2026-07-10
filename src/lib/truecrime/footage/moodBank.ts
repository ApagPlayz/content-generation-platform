// Mood-bank tier adapter. Thin wrapper over ../moodBank's selectMoodClips +
// extractMoodStill. Keyless and networkless — reads whatever CC0/PD atmosphere
// clips the owner has populated under assets/mood-bank/, maps the beat's cue to
// a category, and poster-frames the chosen clip into a beat-indexed still. Empty
// bank → selectMoodClips returns [] → this tier returns null and the ladder
// falls through to the Wikimedia floor.

import { existsSync } from 'fs'
import { selectMoodClips, extractMoodStill } from '../moodBank'
import type { Tier } from '../footage'

export const moodBankTier: Tier = async ({ beat, beatIndex, dest }) => {
  try {
    const clips = await selectMoodClips(beat.visualCue || '', 1, beatIndex)
    const clip = clips[0]
    if (!clip || !clip.path) return null

    const still = await extractMoodStill(clip.path, dest)
    if (!still || !existsSync(still)) return null

    return { imagePath: still, asset: { ...clip.asset, beatIndex } }
  } catch {
    return null
  }
}
