// Cross-stage "have we already covered this?" helper (dedup + rotation).
//
// The factories used to pick a case/topic/player from a fixed watchlist using
// `new Date().getDate() % length` as the start index — the SAME value all day,
// so every same-day run picked the same subject, and nothing ever consulted
// what had already been produced. Result: the corpus filled with duplicates
// (5× Wright Brothers, 5× Panic of 1907 …).
//
// This module fixes both halves:
//   1. EXCLUSION — recentCoverage() reads the ComplianceReport ledger (the
//      authoritative per-factory record of what each factory actually shipped:
//      `caseName` + `factoryType`, written for F9/F10/F11) and, as a fallback,
//      recent Video titles. orderByCoverageAndRotation() then pushes already-
//      covered candidates to the back.
//   2. ROTATION — nextRotationCursor() persists a per-factory counter in the
//      Setting table that ADVANCES on every discovery call, so repeated
//      same-day runs move forward instead of re-picking index N.
//
// Everything is fail-open: if the whole watchlist is already covered we still
// return an ordering (least-recently-covered first) so the run never dead-ends,
// and DB hiccups degrade to a plain cursor rotation rather than throwing.

import { prisma } from '../prisma'

/**
 * Normalize a case / topic / subject name for dedup matching: lowercase, drop
 * parenthetical years and bare years, strip punctuation, collapse whitespace.
 * "Leopold and Loeb (1924)" and "Leopold and Loeb" both → "leopold and loeb".
 */
export function normalizeSubject(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parentheticals, e.g. "(1924)"
    .replace(/\b(1[5-9]|20)\d{2}\b/g, ' ') // drop bare 4-digit years
    .replace(/[^a-z0-9]+/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

/** One recently-covered subject, most-recent-first when returned as a list. */
export interface CoverageEntry {
  /** Normalized covered text (from ComplianceReport.caseName / Video.title). */
  normalized: string
  coveredAt: Date
}

export interface CoverageOptions {
  /** Factory type discriminator stored on ComplianceReport ('F9'|'F10'|'F11'). */
  factoryType: string
  /** Narrow to a single factory when known (via the Video relation). */
  factoryId?: string
  /** Keep at least the newest N covered subjects (default 20). */
  limit?: number
  /** …OR anything covered within this many days, whichever set is LARGER (default 30). */
  days?: number
  /** Injected for tests; defaults to the real Prisma client. */
  db?: CoverageDeps
}

/** The slice of Prisma this module touches — injectable so tests need no DB. */
export interface CoverageDeps {
  complianceReport: {
    findMany: (args: unknown) => Promise<{ caseName: string; createdAt: Date }[]>
  }
  video: {
    findMany: (args: unknown) => Promise<{ title: string | null; createdAt: Date }[]>
  }
  setting: {
    findUnique: (args: unknown) => Promise<{ value: string } | null>
    upsert: (args: unknown) => Promise<unknown>
  }
}

/**
 * Recently-covered subjects for a factory, most-recent first. Reads the
 * ComplianceReport ledger first (its `caseName` is exactly the subject each run
 * produced) and merges in recent Video titles as a backstop for runs that
 * failed before the compliance stage. "Whichever is more" = the union of the
 * newest `limit` rows and everything newer than `days`. Fail-open: on any DB
 * error it returns [] so discovery simply falls back to plain rotation.
 */
export async function recentCoverage(opts: CoverageOptions): Promise<CoverageEntry[]> {
  const db = opts.db ?? (prisma as unknown as CoverageDeps)
  const limit = opts.limit ?? 20
  const days = opts.days ?? 30
  const since = new Date(Date.now() - days * 86_400_000)
  const cap = Math.max(limit, 200)

  try {
    const reportWhere: Record<string, unknown> = { factoryType: opts.factoryType }
    if (opts.factoryId) reportWhere.video = { factoryId: opts.factoryId }
    const videoWhere: Record<string, unknown> = opts.factoryId
      ? { factoryId: opts.factoryId }
      : { factory: { type: opts.factoryType } }

    const [reports, videos] = await Promise.all([
      db.complianceReport.findMany({
        where: reportWhere,
        orderBy: { createdAt: 'desc' },
        take: cap,
        select: { caseName: true, createdAt: true },
      }),
      db.video.findMany({
        where: videoWhere,
        orderBy: { createdAt: 'desc' },
        take: cap,
        select: { title: true, createdAt: true },
      }),
    ])

    const merged: CoverageEntry[] = [
      ...reports.map((r) => ({ normalized: normalizeSubject(r.caseName), coveredAt: r.createdAt })),
      ...videos.map((v) => ({
        normalized: normalizeSubject(v.title ?? ''),
        coveredAt: v.createdAt,
      })),
    ]
      .filter((e) => e.normalized.length > 0)
      .sort((a, b) => b.coveredAt.getTime() - a.coveredAt.getTime())

    // "last N OR last `days`, whichever is more": keep a row if it is within the
    // newest `limit` rows OR newer than `since`.
    return merged.filter((e, i) => i < limit || e.coveredAt >= since)
  } catch (err) {
    console.warn(
      `[coverage] could not read recent coverage for ${opts.factoryType} — proceeding without exclusion:`,
      err instanceof Error ? err.message : String(err)
    )
    return []
  }
}

/**
 * The most-recent time (ms epoch) a candidate name was covered, or null if never.
 * A candidate is "covered" when its normalized name appears inside any coverage
 * entry's normalized text — handles "Leopold and Loeb" == the F10 caseName and
 * "Jordan" ⊂ the F9 "Career highlights feature for Michael Jordan …" caseName.
 * Pure; exported so discovery's viability walk can apply the covered-cooldown.
 */
export function lastCoveredAt(name: string, coverage: CoverageEntry[]): number | null {
  const norm = normalizeSubject(name)
  if (!norm) return null
  let latest: number | null = null
  for (const e of coverage) {
    if (e.normalized.includes(norm)) {
      const t = e.coveredAt.getTime()
      if (latest === null || t > latest) latest = t
    }
  }
  return latest
}

/** Result of ordering a watchlist by coverage + rotation. */
export interface RotationOrder<T> {
  /** Candidates in try-order: uncovered first (rotated by the cursor), then
   *  already-covered ones least-recently-covered first (the fail-open tail). */
  ordered: T[]
  /** True when EVERY candidate was already covered (watchlist exhausted). */
  exhausted: boolean
}

/** How many of the NEWEST uncovered candidates the rotation cursor cycles
 *  within, in recency mode. Recency wins overall (old topics stay at the back),
 *  but the cursor still varies WHICH of the top-N newest a same-day rerun picks
 *  first — so we don't ship the single newest topic on every run, yet never dip
 *  into the ancient tail while recent, viable stories remain. */
export const RECENT_BAND_SIZE = 8

/** Optional recency tuning for orderByCoverageAndRotation. When `yearOf` is
 *  supplied the uncovered candidates are ordered NEWEST-FIRST by event year and
 *  the cursor rotates only within the `recentBandSize` newest of them. Omitted
 *  ⇒ the original whole-list rotation (unchanged). */
export interface RotationTuning<T> {
  yearOf?: (c: T) => number | undefined
  recentBandSize?: number
}

/**
 * Order a watchlist so dedup takes priority over recency/rotation, and (in
 * recency mode) recency takes priority over rotation, which takes priority over
 * the fixed list order:
 *   • Uncovered candidates come first. In the DEFAULT (legacy) mode they are
 *     rotated so the cursor advances the start point each run. In RECENCY mode
 *     (a `yearOf` is passed) they are ordered NEWEST-event-year first, and the
 *     cursor rotates only within the `recentBandSize` newest — so the picker
 *     prefers modern, footage-rich stories while a same-day rerun still varies
 *     which of the recent band it opens with.
 *   • Covered candidates form the tail, least-recently-covered first — so if the
 *     whole list is exhausted we still fail open to the stalest subject.
 * A candidate is "covered" when its normalized name appears inside any coverage
 * entry's normalized text (handles "Leopold and Loeb" == the F10 caseName and
 * "Jordan" ⊂ the F9 "Career highlights feature for Michael Jordan …" caseName).
 * The covered/cooldown/viability rules downstream in selectViableCandidate are
 * untouched — this only reorders the UNCOVERED head it walks first.
 * Pure + deterministic so the media-richness gate and tests can drive it.
 */
export function orderByCoverageAndRotation<T>(
  candidates: T[],
  nameOf: (c: T) => string,
  coverage: CoverageEntry[],
  cursor: number,
  tuning: RotationTuning<T> = {}
): RotationOrder<T> {
  const n = candidates.length
  if (n === 0) return { ordered: [], exhausted: false }

  if (tuning.yearOf) {
    // RECENCY MODE — split covered/uncovered from the raw list (order-independent
    // here because uncovered is re-sorted by year and covered by LRU below).
    const yearOf = tuning.yearOf
    const uncovered: T[] = []
    const covered: { c: T; at: number }[] = []
    for (const c of candidates) {
      const at = lastCoveredAt(nameOf(c), coverage)
      if (at === null) uncovered.push(c)
      else covered.push({ c, at })
    }
    // Newest event-year first; an undefined year sorts last (treated as oldest);
    // ties keep the original watchlist order (stable) for determinism.
    const byYearDesc = uncovered
      .map((c, i) => ({ c, i, y: yearOf(c) ?? Number.NEGATIVE_INFINITY }))
      .sort((a, b) => b.y - a.y || a.i - b.i)
      .map((x) => x.c)
    // Rotate the cursor WITHIN the newest band only — recent stays ahead of old.
    const band = Math.min(tuning.recentBandSize ?? RECENT_BAND_SIZE, byYearDesc.length)
    const head = byYearDesc.slice(0, band)
    const tail = byYearDesc.slice(band)
    const start = band > 0 ? (((cursor % band) + band) % band) : 0
    const rotatedHead = [...head.slice(start), ...head.slice(0, start)]
    covered.sort((a, b) => a.at - b.at) // least-recently-covered first
    return {
      ordered: [...rotatedHead, ...tail, ...covered.map((x) => x.c)],
      exhausted: uncovered.length === 0,
    }
  }

  // DEFAULT MODE (unchanged): walk the list starting at the rotation cursor so
  // the start point moves each run; split into uncovered (kept in rotated order)
  // and covered.
  const start = ((cursor % n) + n) % n
  const uncovered: T[] = []
  const covered: { c: T; at: number }[] = []
  for (let i = 0; i < n; i++) {
    const c = candidates[(start + i) % n]
    const at = lastCoveredAt(nameOf(c), coverage)
    if (at === null) uncovered.push(c)
    else covered.push({ c, at })
  }
  covered.sort((a, b) => a.at - b.at) // least-recently-covered first

  return {
    ordered: [...uncovered, ...covered.map((x) => x.c)],
    exhausted: uncovered.length === 0,
  }
}

/** A candidate covered within this many days is NEVER re-picked — the run
 *  fails visibly rather than silently repeating a subject we just shipped. */
export const COVERED_COOLDOWN_DAYS = 7

/** Thrown when no watchlist candidate is pickable (every uncovered one is
 *  non-viable AND every covered one is either inside the cooldown or non-viable).
 *  A visible failure the operator can act on, not a silent duplicate. */
export class NoViableCandidateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoViableCandidateError'
  }
}

export interface ViablePick<T> {
  chosen: T
  /** Usable images confirmed for the winner (≥ minImages). */
  images: number
  /** True when the winner was already covered (all uncovered were non-viable). */
  wasCovered: boolean
}

export interface ViabilityOptions<T> {
  /** Name used for coverage matching (case/topic name). */
  nameOf: (c: T) => string
  /** Recent coverage ledger (from recentCoverage). */
  coverage: CoverageEntry[]
  /** Async usable-image probe; a throw counts as 0 (non-viable), never dead-ends. */
  imageCountOf: (c: T) => Promise<number>
  /** Minimum usable images for a candidate to be viable. */
  minImages: number
  /** Days a covered subject stays off-limits. Default COVERED_COOLDOWN_DAYS. */
  cooldownDays?: number
  /** Injected clock for tests. */
  now?: number
}

/**
 * Walk an already-ordered (uncovered-first, covered-LRU-tail — the output of
 * orderByCoverageAndRotation) candidate list and return the FIRST viable one,
 * enforcing the fixed picker contract:
 *   • UNCOVERED-FIRST — uncovered candidates lead `ordered`, so an uncovered
 *     viable candidate always wins before ANY covered one is even probed.
 *   • COOLDOWN — a candidate covered within `cooldownDays` is skipped outright
 *     and can never be picked (kills the "re-covered the same day" bug).
 *   • LRU FALLBACK — only once every uncovered candidate is non-viable are the
 *     covered ones considered, least-recently-covered first (the tail order).
 * "Viable" = imageCountOf(c) ≥ minImages (a throwing probe = 0 = non-viable).
 * Throws NoViableCandidateError when nothing pickable remains, so the run fails
 * visibly instead of silently repeating a recent subject.
 */
export async function selectViableCandidate<T>(
  ordered: T[],
  opts: ViabilityOptions<T>
): Promise<ViablePick<T>> {
  const now = opts.now ?? Date.now()
  const cooldownDays = opts.cooldownDays ?? COVERED_COOLDOWN_DAYS
  const cooldownMs = cooldownDays * 86_400_000
  for (const c of ordered) {
    const covAt = lastCoveredAt(opts.nameOf(c), opts.coverage)
    const wasCovered = covAt !== null
    // Recently covered → never pick, whatever its image pool looks like.
    if (wasCovered && now - covAt < cooldownMs) continue
    let images = 0
    try {
      images = await opts.imageCountOf(c)
    } catch {
      images = 0 // a flaky probe must never dead-end discovery
    }
    if (images >= opts.minImages) return { chosen: c, images, wasCovered }
  }
  throw new NoViableCandidateError(
    `all watchlist topics exhausted or non-viable — no candidate has ≥${opts.minImages} ` +
      `usable images outside the ${cooldownDays}-day coverage cooldown. Curate more topics.`
  )
}

/**
 * Return the CURRENT per-factory rotation cursor and persist the ADVANCE, so the
 * next discovery call (even the same day, even after a process restart) starts
 * one step further along. Stored as an ever-incrementing integer in the Setting
 * table under `rotation_cursor:<key>`; callers apply `% length` themselves, so a
 * changing watchlist size can never corrupt it. Fail-open: on any DB error it
 * falls back to the day-of-month so rotation still varies across days.
 */
export async function nextRotationCursor(
  key: string,
  db: Pick<CoverageDeps, 'setting'> = prisma as unknown as CoverageDeps
): Promise<number> {
  const settingKey = `rotation_cursor:${key}`
  try {
    const row = await db.setting.findUnique({ where: { key: settingKey } })
    const parsed = row ? parseInt(row.value, 10) : 0
    const current = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    await db.setting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, value: String(current + 1) },
      update: { value: String(current + 1) },
    })
    return current
  } catch (err) {
    console.warn(
      `[coverage] rotation cursor "${key}" unavailable — falling back to day-of-month:`,
      err instanceof Error ? err.message : String(err)
    )
    return new Date().getDate()
  }
}
