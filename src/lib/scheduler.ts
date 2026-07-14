import { prisma } from './prisma'
import { executeRun } from './run'
import { recoverStuckRuns } from './recovery'

/**
 * Scheduler core. The app runs in-process with no background daemon, so the
 * `/api/scheduler/tick` endpoint (hit by an external cron or the dashboard
 * "Run due now" button) drives all of this: it finds every due schedule, fires
 * the agent runs, and advances each schedule's nextRunAt.
 */

type Cadence = 'hourly' | 'daily' | 'weekly'

interface ScheduleTiming {
  cadence: string
  hourUTC: number | null
  minuteUTC: number
  dayOfWeek: number | null
}

/**
 * Pure: the next UTC fire time strictly after `from` for the given cadence.
 * - hourly → next top-of-hour at minuteUTC
 * - daily  → next day at hourUTC:minuteUTC (today if still in the future)
 * - weekly → next dayOfWeek at hourUTC:minuteUTC
 * Defaults: hourUTC=12, dayOfWeek=1 (Mon) when null.
 */
export function computeNextRun(s: ScheduleTiming, from: Date = new Date()): Date {
  const cadence = s.cadence as Cadence
  const minute = s.minuteUTC ?? 0
  const hour = s.hourUTC ?? 12
  const dow = s.dayOfWeek ?? 1

  const next = new Date(from.getTime())
  next.setUTCSeconds(0, 0)

  if (cadence === 'hourly') {
    next.setUTCMinutes(minute)
    // If still at/before `from`, advance to the next hour.
    if (next.getTime() <= from.getTime()) {
      next.setUTCHours(next.getUTCHours() + 1)
    }
    return next
  }

  if (cadence === 'weekly') {
    next.setUTCHours(hour, minute, 0, 0)
    // Advance day-by-day until we land on the target weekday strictly after `from`.
    let guard = 0
    while (
      (next.getUTCDay() !== dow || next.getTime() <= from.getTime()) &&
      guard < 8
    ) {
      next.setUTCDate(next.getUTCDate() + 1)
      next.setUTCHours(hour, minute, 0, 0)
      guard++
    }
    return next
  }

  // daily (default)
  next.setUTCHours(hour, minute, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

/**
 * Find enabled schedules that are due (nextRunAt <= now) and whose agent is
 * enabled. Advance lastRunAt/nextRunAt FIRST so a slow or failed run isn't
 * retried in a tight loop, then fire all runs together via Promise.allSettled.
 */
export async function runDueSchedules(
  now: Date = new Date()
): Promise<{ ran: string[]; errors: { scheduleId: string; error: string }[] }> {
  // Before scheduling anything, heal runs/videos/jobs orphaned by a crash or
  // restart (the in-process pipeline leaves them stuck 'running'/'rendering'
  // forever otherwise). This tick is driven on startup and every 60s by the
  // in-process auto-tick, plus the external /api/scheduler/tick route and the
  // dashboard "Run due now" button — so recovery happens everywhere ticks do.
  // A recovery failure must never block real scheduling, so it's swallowed.
  try {
    const healed = await recoverStuckRuns(now)
    if (healed.runs || healed.videos || healed.jobs) {
      console.log(
        `[recovery] reset ${healed.runs} run(s), ${healed.videos} video(s), ` +
          `${healed.jobs} job(s) left stuck by a crash or restart`
      )
    }
  } catch (e) {
    console.warn('[recovery] sweep failed:', e instanceof Error ? e.message : e)
  }

  const due = await prisma.schedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { not: null, lte: now },
      agent: { enabled: true },
    },
    include: { agent: { select: { id: true, enabled: true } } },
  })

  const ran: string[] = []
  const errors: { scheduleId: string; error: string }[] = []

  const results = await Promise.allSettled(
    due.map(async (s) => {
      // Advance timing first so failures/slowness don't cause re-fire.
      await prisma.schedule.update({
        where: { id: s.id },
        data: {
          lastRunAt: now,
          nextRunAt: computeNextRun(s, now),
        },
      })
      try {
        await executeRun(s.agentId)
        return { scheduleId: s.id, ok: true as const }
      } catch (e) {
        return {
          scheduleId: s.id,
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.ok) ran.push(r.value.scheduleId)
      else errors.push({ scheduleId: r.value.scheduleId, error: r.value.error })
    } else {
      errors.push({
        scheduleId: 'unknown',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  }

  return { ran, errors }
}

/**
 * If a schedule is enabled and has no nextRunAt yet, compute and persist one.
 * Call on create or re-enable.
 */
export async function ensureNextRun(scheduleId: string): Promise<void> {
  const s = await prisma.schedule.findUnique({ where: { id: scheduleId } })
  if (!s || !s.enabled || s.nextRunAt) return
  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { nextRunAt: computeNextRun(s) },
  })
}
