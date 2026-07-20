// archive.org tier adapter. Thin wrapper over ../archiveFootage: with the
// shared per-video ArchiveStillPool (the normal path via resolveBeatFootage)
// each beat draws a DISTINCT archive.org item from one video-level search, so
// a single reel can no longer repeat across every beat. Without a pool it
// degrades to the old per-beat fetchArchiveClipForBeat walk over the
// broad-to-narrow query candidates. Either way license mapping stays
// conservative — anything not provably PD/CC stays 'unknown' (→ compliance
// 'review') and depictsRealPerson defaults to true — so this tier is
// fail-closed by design. Returns null on any miss so the ladder falls through.
//
// STAGING (round-3 regression fix): every resolved still is COPIED from the
// cross-run cache (media/stock/archive.org/) into the beat-indexed `dest`
// inside the per-video dir, and `dest` is what this tier returns — the same
// contract the stock/mood-bank tiers honor. The Remotion render serves ONLY
// the per-video dir over loopback and references assets by basename, so a raw
// cache path 404s there and the beat renders black. Staging also means no
// later cache purge (e.g. the luma gate evicting a stale near-black still on
// another video's run) can delete a frame after it was selected for this beat.

import { copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { fetchArchiveClipForBeat } from '../archiveFootage'
import type { ArchiveFootageResult } from '../archiveFootage'
import type { Tier, TierOutput } from '../footage'

/** Copy a resolved cache still into the per-video staged path and build the
 *  tier output around it. Null when the source vanished or the copy failed —
 *  a raw cache path must never leak out (Remotion cannot serve it). */
async function stageResult(
  result: ArchiveFootageResult | null,
  dest: string,
  beatIndex: number
): Promise<TierOutput | null> {
  if (!result || !result.localPath || !existsSync(result.localPath)) return null
  try {
    await copyFile(result.localPath, dest)
  } catch {
    return null
  }
  if (!existsSync(dest)) return null
  return { imagePath: dest, asset: { ...result.visual, beatIndex } }
}

export const archiveTier: Tier = async ({ query, archiveQuery, archiveQueries, beatIndex, config, dest, archivePool, slot }) => {
  try {
    // Preferred path: the per-video pool. Slot 0 draws a DISTINCT reel; extra
    // slots reuse the beat's already-fetched reel at a different timestamp
    // (round 7 — halves the distinct-reel fetch load, still no identical
    // frames). Both paths run the same junk/luma/staging pipeline.
    if (archivePool) {
      const result =
        slot && slot > 0
          ? await archivePool.acquireSecondFrame(beatIndex, slot)
          : await archivePool.acquireStill(beatIndex)
      return await stageResult(result, dest, beatIndex)
    }

    // Fallback (no pool supplied): walk the broad-to-narrow query candidates
    // (topic+year+cue → topic+year → topic → era+mood → bare cue). archive.org
    // ANDs every term, so the most specific query frequently has zero hits
    // while a broader one lands era newsreels — stop at the first candidate
    // that yields a usable still.
    const candidates = archiveQueries?.length ? archiveQueries : [archiveQuery ?? query]
    for (const q of candidates) {
      const result = await fetchArchiveClipForBeat(q, {
        collections: config.archiveCollections,
        beatIndex,
        maxClips: config.archiveMaxClips,
      })
      const staged = await stageResult(result, dest, beatIndex)
      if (staged) return staged
    }
    return null
  } catch {
    return null
  }
}
