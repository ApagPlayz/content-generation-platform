// Visual-repetition fingerprinting — the per-asset identity check the gate has
// none of today. The text/structure variation axes would never notice the exact
// same Wikimedia photo (or stock clip) reused across ten videos; this closes that
// hole. Pure and dependency-free (node:crypto only), so it never hard-fails and
// works with zero API keys.

import { createHash } from 'node:crypto'
import type { VisualAsset } from './types'

/**
 * Normalize an asset source URL to a stable identity so the SAME underlying
 * image fingerprints identically regardless of query string, fragment, or the
 * size variant it was served at. Wikimedia thumbnails
 * (…/thumb/<dirs>/<File>/<size>px-<File>) collapse to the original
 * (…/<dirs>/<File>). Non-URL sources (local paths / provider ids) are lowercased.
 */
function normalizeSource(source: string): string {
  const raw = (source || '').trim()
  if (!raw) return ''
  // Drop fragment + query before anything else.
  const bare = raw.split('#')[0].split('?')[0]
  try {
    const u = new URL(bare)
    let path = u.pathname
    const thumb = path.match(/^(.*)\/thumb\/(.+)\/\d+px-[^/]+$/)
    if (thumb) path = `${thumb[1]}/${thumb[2]}`
    return `${u.host}${path}`.toLowerCase()
  } catch {
    // Not a URL — normalize loosely so the same local file still matches.
    return bare.toLowerCase()
  }
}

/**
 * A set of short, stable hex ids — one per distinct visual asset. De-duped, so
 * repeating the same photo twice in one video counts once.
 */
export function computeVisualSignature(visuals: VisualAsset[]): string[] {
  const ids = new Set<string>()
  for (const v of visuals ?? []) {
    // AI stills are generated fresh per render, yet share a stable provider id
    // (e.g. "ai-still:local:0") across videos — they are NOT reused footage, so
    // fingerprinting them would falsely flag distinct videos as repetitive.
    if (v?.aiGenerated || /^ai-still:/i.test(v?.source ?? '')) continue
    const norm = normalizeSource(v?.source ?? '')
    if (!norm) continue
    ids.add(createHash('sha1').update(norm).digest('hex').slice(0, 16))
  }
  return Array.from(ids)
}

/** Jaccard overlap of two visual-signature id-sets (0 = no shared footage). */
export function visualRepetition(current: string[], prior: string[]): number {
  const a = new Set(current ?? [])
  const b = new Set(prior ?? [])
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
