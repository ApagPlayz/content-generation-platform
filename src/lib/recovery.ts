// Crash/restart recovery for orphaned work.
//
// Runs execute IN-PROCESS with no background daemon (`/api/agents/[id]/run`
// fire-and-forgets `executeRun`). If the dev server reloads (any file save),
// crashes, or runs out of memory mid-render, the dead process never reaches the
// orchestrator's own `try/catch`, so it leaves `AgentRun.status='running'`, an
// in-flight `Video` (`queued` for most of the pipeline, `rendering` only at the
// final assemble step), and the in-flight `Job` (`running`, or `retrying` while
// it sleeps between attempts) stuck forever. Nothing reconciles them, so the
// owner sees a spinner that never stops and no error.
//
// This module flips that leftover work to `failed` once it is older than a sane
// timeout, so the owner sees "interrupted — re-run?" instead of a permanent
// spinner. A timeout (not "any running row") is used so a genuinely live run is
// never killed; if the timeout is ever too tight, a false-positive self-heals —
// when the real render finishes it overwrites the row with its true status.

/** Default: a run/video/job in flight longer than this is treated as orphaned. */
export const DEFAULT_STUCK_TIMEOUT_MS = 30 * 60_000 // 30 minutes

/** Plain-language reason stamped on runs/jobs recovered after a crash. */
export const INTERRUPTED_REASON =
  'Interrupted — the app crashed or restarted while this run was in progress.'

/**
 * Video statuses that mean "still in flight" and so are swept once orphaned.
 * A video is created `queued` and only flips to `rendering` at the very last
 * (assemble) step, so it spends almost the whole pipeline as `queued` — if the
 * process dies at an earlier stage the video stays `queued` forever. Both must
 * be healed or those early-crash videos sit on a blue "Queued" badge with no
 * error. Terminal states (approved/review/rejected/failed/published) are left
 * untouched so finished work is never re-failed.
 */
export const RECOVERABLE_VIDEO_STATUSES = ['queued', 'rendering'] as const

/**
 * Job statuses that mean "still in flight". A job runs as `running` and flips
 * to `retrying` while it sleeps through backoff between attempts, so a crash
 * mid-backoff strands it on `retrying`; both must be swept. Terminal states
 * (completed/failed) are left untouched.
 */
export const RECOVERABLE_JOB_STATUSES = ['running', 'retrying'] as const

/**
 * Pure: turn a `RUN_STUCK_TIMEOUT_MIN` minutes-string into milliseconds, falling
 * back to the default for anything missing, non-numeric, or non-positive. Kept
 * separate (and pure) so the timeout math is unit-tested without a database.
 */
export function resolveTimeoutMs(rawMinutes: string | undefined): number {
  const minutes = Number(rawMinutes)
  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60_000
    : DEFAULT_STUCK_TIMEOUT_MS
}

/**
 * Pure: the age cutoff. A row whose age-timestamp (`startedAt` for runs/jobs,
 * `updatedAt` for videos) is strictly before this is considered orphaned.
 */
export function stuckCutoff(now: Date, timeoutMs: number): Date {
  return new Date(now.getTime() - timeoutMs)
}

/**
 * Reconcile work orphaned by a crash or restart, in one transaction:
 *   - AgentRun  'running'               older than the timeout → 'failed' + interrupted reason
 *   - Video     'queued' | 'rendering'  older than the timeout → 'failed'  (shows a red badge)
 *   - Job       'running' | 'retrying'  older than the timeout → 'failed' + interrupted reason
 *
 * Videos are swept independently of the run's `videoIds` so it still works when a
 * crash happened before `videoIds` was written. Idempotent and safe to call on
 * every scheduler tick — the timeout guard means an actually-live run is left be.
 */
export async function recoverStuckRuns(
  now: Date = new Date(),
  timeoutMs: number = resolveTimeoutMs(process.env.RUN_STUCK_TIMEOUT_MIN)
): Promise<{ runs: number; videos: number; jobs: number }> {
  // Lazy import so importing the pure helpers above (e.g. in the unit test)
  // never instantiates the Prisma client.
  const { prisma } = await import('./prisma')
  const cutoff = stuckCutoff(now, timeoutMs)

  const [runs, videos, jobs] = await prisma.$transaction([
    prisma.agentRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: { status: 'failed', error: INTERRUPTED_REASON, finishedAt: now },
    }),
    prisma.video.updateMany({
      where: {
        status: { in: [...RECOVERABLE_VIDEO_STATUSES] },
        updatedAt: { lt: cutoff },
      },
      data: { status: 'failed' },
    }),
    prisma.job.updateMany({
      where: {
        status: { in: [...RECOVERABLE_JOB_STATUSES] },
        startedAt: { lt: cutoff },
      },
      data: { status: 'failed', error: INTERRUPTED_REASON, finishedAt: now },
    }),
  ])

  return { runs: runs.count, videos: videos.count, jobs: jobs.count }
}
