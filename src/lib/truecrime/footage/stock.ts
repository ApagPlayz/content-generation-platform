// Stock-footage tier adapter. Thin wrapper over ../stockFootage's
// sourceStockClips (Pexels → Pixabay). Those helpers return vertical VIDEO
// clips; the current assemble path is a still slideshow, so we poster-frame the
// clip into a beat-indexed still via ../moodBank's extractMoodStill. Key-gated
// (returns null with no PEXELS/PIXABAY key) and skipped for beats naming a real
// subject. The asset keeps its honest 'licensed' license + provider licenseRef.

import { existsSync } from 'fs'
import { sourceStockClips } from '../stockFootage'
import { extractMoodStill } from '../moodBank'
import type { Tier } from '../footage'

export const stockTier: Tier = async ({ videoId, query, beatIndex, config, dest, realSubject }) => {
  if (realSubject) return null

  try {
    const maxPer = config.maxStockClipsPerBeat ?? 1
    const { clips } = await sourceStockClips(videoId, [{ beatIndex, query }], maxPer)
    const clip = clips[0]
    if (!clip || !clip.localPath) return null

    // Poster-frame the vertical clip into a still so the current assemble works.
    const still = await extractMoodStill(clip.localPath, dest)
    if (!still || !existsSync(still)) return null

    return { imagePath: still, asset: { ...clip.visual, beatIndex } }
  } catch {
    return null
  }
}
