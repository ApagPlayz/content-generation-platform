// archive.org tier adapter. Thin wrapper over ../archiveFootage's
// fetchArchiveClipForBeat, which is keyless and already returns a still-image
// path (a downloaded image or an ffmpeg poster frame). The helper maps license
// conservatively — anything not provably PD/CC stays 'unknown' (→ compliance
// 'review') and depictsRealPerson defaults to true — so this tier is fail-closed
// by design. Returns null on any miss so the ladder falls through.

import { existsSync } from 'fs'
import { fetchArchiveClipForBeat } from '../archiveFootage'
import type { Tier } from '../footage'

export const archiveTier: Tier = async ({ query, archiveQuery, archiveQueries, beatIndex, config }) => {
  try {
    // Walk the broad-to-narrow query candidates (topic+year+cue → topic+year →
    // topic → era+mood → bare cue). archive.org ANDs every term, so the most
    // specific query frequently has zero hits while a broader one lands era
    // newsreels — stop at the first candidate that yields a usable still.
    const candidates = archiveQueries?.length ? archiveQueries : [archiveQuery ?? query]
    for (const q of candidates) {
      const result = await fetchArchiveClipForBeat(q, {
        collections: config.archiveCollections,
        beatIndex,
        maxClips: config.archiveMaxClips,
      })
      if (result && result.localPath && existsSync(result.localPath)) {
        return { imagePath: result.localPath, asset: { ...result.visual, beatIndex } }
      }
    }
    return null
  } catch {
    return null
  }
}
