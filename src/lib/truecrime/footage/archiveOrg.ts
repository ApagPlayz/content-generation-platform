// archive.org tier adapter. Thin wrapper over ../archiveFootage's
// fetchArchiveClipForBeat, which is keyless and already returns a still-image
// path (a downloaded image or an ffmpeg poster frame). The helper maps license
// conservatively — anything not provably PD/CC stays 'unknown' (→ compliance
// 'review') and depictsRealPerson defaults to true — so this tier is fail-closed
// by design. Returns null on any miss so the ladder falls through.

import { existsSync } from 'fs'
import { fetchArchiveClipForBeat } from '../archiveFootage'
import type { Tier } from '../footage'

export const archiveTier: Tier = async ({ query, beatIndex, config }) => {
  try {
    const result = await fetchArchiveClipForBeat(query, {
      collections: config.archiveCollections,
      beatIndex,
    })
    if (!result || !result.localPath || !existsSync(result.localPath)) return null

    return { imagePath: result.localPath, asset: { ...result.visual, beatIndex } }
  } catch {
    return null
  }
}
