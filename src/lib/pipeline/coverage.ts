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

/** Result of ordering a watchlist by coverage + rotation. */
export interface RotationOrder<T> {
  /** Candidates in try-order: uncovered first (rotated by the cursor), then
   *  already-covered ones least-recently-covered first (the fail-open tail). */
  ordered: T[]
  /** True when EVERY candidate was already covered (watchlist exhausted). */
  exhausted: boolean
}

/**
 * Order a watchlist so dedup takes priority over rotation, and rotation takes
 * priority over the fixed list order:
 *   • Uncovered candidates come first, rotated so the cursor advances the start
 *     point each run (kills the "same pick all day" bug).
 *   • Covered candidates form the tail, least-recently-covered first — so if the
 *     whole list is exhausted we still fail open to the stalest subject.
 * A candidate is "covered" when its normalized name appears inside any coverage
 * entry's normalized text (handles "Leopold and Loeb" == the F10 caseName and
 * "Jordan" ⊂ the F9 "Career highlights feature for Michael Jordan …" caseName).
 * Pure + deterministic so the media-richness gate and tests can drive it.
 */
export function orderByCoverageAndRotation<T>(
  candidates: T[],
  nameOf: (c: T) => string,
  coverage: CoverageEntry[],
  cursor: number
): RotationOrder<T> {
  const n = candidates.length
  if (n === 0) return { ordered: [], exhausted: false }

  const lastCoveredAt = (c: T): number | null => {
    const name = normalizeSubject(nameOf(c))
    if (!name) return null
    let latest: number | null = null
    for (const e of coverage) {
      if (e.normalized.includes(name)) {
        const t = e.coveredAt.getTime()
        if (latest === null || t > latest) latest = t
      }
    }
    return latest
  }

  // Walk the list starting at the rotation cursor so the start point moves each
  // run; split into uncovered (kept in rotated order) and covered.
  const start = ((cursor % n) + n) % n
  const uncovered: T[] = []
  const covered: { c: T; at: number }[] = []
  for (let i = 0; i < n; i++) {
    const c = candidates[(start + i) % n]
    const at = lastCoveredAt(c)
    if (at === null) uncovered.push(c)
    else covered.push({ c, at })
  }
  covered.sort((a, b) => a.at - b.at) // least-recently-covered first

  return {
    ordered: [...uncovered, ...covered.map((x) => x.c)],
    exhausted: uncovered.length === 0,
  }
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
