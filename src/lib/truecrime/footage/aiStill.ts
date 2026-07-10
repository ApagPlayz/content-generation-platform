// AI-still tier adapter. Thin wrapper over ../aiStill's generateStillForBeat.
// Produces ONE symbolic, atmospheric still (never a real-person likeness) for
// the beat. Key-gated: skips entirely when no paid AI-image key is present so
// the keyless local-gradient fallback never masquerades as real footage and the
// ladder can fall through to stock/archive/moodbank/Wikimedia. Also skips beats
// whose cue names a real subject (we never AI-depict a real person).

import { existsSync } from 'fs'
import { generateStillForBeat } from '../aiStill'
import type { Tier } from '../footage'

export const aiStillTier: Tier = async ({ videoId, beat, beatIndex, config, realSubject }) => {
  if (realSubject) return null

  const explicit = (config.aiStillProvider || process.env.AI_IMAGE_PROVIDER || '').trim().toLowerCase()
  const hasKey = Boolean(process.env.OPENAI_API_KEY || process.env.STABILITY_API_KEY)
  // Only fire when a real generator is reachable. 'local' is the helper's keyless
  // gradient fallback — useful as a floor elsewhere, but not a footage "win" here.
  if (!hasKey || explicit === 'local') return null

  try {
    const { path: stillPath, provider } = await generateStillForBeat(beat, {
      videoId,
      index: beatIndex,
      provider: explicit || undefined,
      model: config.aiImageModel,
      style: config.aiStillStyle,
    })
    if (!stillPath || !existsSync(stillPath)) return null
    if (provider === 'local' || provider === 'none') return null // paid gen failed → skip tier

    return {
      imagePath: stillPath,
      asset: {
        kind: 'image',
        source: `ai-still:${provider}:${beatIndex}`,
        license: 'ai_generated',
        depictsRealPerson: false, // truthful: the prompt forbids real-person likenesses
        aiGenerated: true,
        beatIndex,
      },
    }
  } catch {
    return null
  }
}
