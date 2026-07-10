// Thin, dependency-free cache helper for the F10 footage stages. It lets any
// footage/stock/archive provider check-before-download and dedupe clips across
// videoIds via the StockClip table (unique on [source, externalId]). Pure
// Prisma + fs — no network, no external CLI — so it never hard-fails when a
// provider key is absent. Cached files live under media/stock/<source>/, kept
// separate from the per-run media/<videoId>/ scratch dirs.
import path from 'path'
import { promises as fs } from 'fs'
import type { StockClip } from '@prisma/client'
import { prisma } from '../prisma'

/** Cross-run cache root for reusable footage, separate from per-run dirs. */
export const STOCK_DIR = path.join(process.cwd(), 'media', 'stock')

/** Cache path for a clip: media/stock/<source>/<externalId>.<ext>. */
export function stockClipPath(source: string, externalId: string, ext = 'mp4'): string {
  const clean = ext.startsWith('.') ? ext.slice(1) : ext
  return path.join(STOCK_DIR, source, `${externalId}.${clean}`)
}

/** Ensure media/stock/<source>/ exists before a download writes into it. */
export async function ensureStockDir(source: string): Promise<string> {
  const dir = path.join(STOCK_DIR, source)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Look up a cached clip by its provider key. Returns null when absent — a
 * graceful miss, never a throw — so callers can fall through to a download.
 */
export async function findCachedClip(
  source: string,
  externalId: string,
): Promise<StockClip | null> {
  return prisma.stockClip.findUnique({
    where: { source_externalId: { source, externalId } },
  })
}

/** Fields the consuming footage stage supplies when caching a downloaded clip. */
export interface StockClipInput {
  source: string
  externalId: string
  localPath: string
  width?: number | null
  height?: number | null
  durationSec?: number | null
  license?: string | null
  attribution?: string | null
  /** Beat indices this clip has been used for; stored JSON-stringified. */
  beatsUsed?: number[]
}

/**
 * Upsert a clip after a successful download. Idempotent on the compound key,
 * so a retried stage attempt never creates a duplicate row. `beatsUsed` is
 * JSON-stringified on write to match the repo's string-JSON convention.
 */
export async function recordStockClip(input: StockClipInput): Promise<StockClip> {
  const beatsUsed =
    input.beatsUsed && input.beatsUsed.length ? JSON.stringify(input.beatsUsed) : null
  const data = {
    localPath: input.localPath,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSec: input.durationSec ?? null,
    license: input.license ?? null,
    attribution: input.attribution ?? null,
    beatsUsed,
  }
  return prisma.stockClip.upsert({
    where: { source_externalId: { source: input.source, externalId: input.externalId } },
    create: { source: input.source, externalId: input.externalId, ...data },
    update: data,
  })
}

/** Parse a StockClip.beatsUsed JSON array back to numbers; [] on any miss. */
export function parseBeatsUsed(clip: Pick<StockClip, 'beatsUsed'>): number[] {
  if (!clip.beatsUsed) return []
  try {
    const parsed = JSON.parse(clip.beatsUsed)
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : []
  } catch {
    return []
  }
}
