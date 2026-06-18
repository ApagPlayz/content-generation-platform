// Next.js instrumentation hook — runs once when the server process starts.
// We use it to drive the scheduler IN-PROCESS so the app no longer needs an
// external cron job: a lightweight interval calls runDueSchedules() every
// minute. The external /api/scheduler/tick route still works (for redundancy or
// cron), and runDueSchedules advances nextRunAt before firing, so an overlapping
// external tick won't double-run a schedule.
//
// Controlled by the `scheduler_autotick_enabled` setting (default ON). Turn it
// off in Settings if you'd rather drive ticks externally.

const TICK_INTERVAL_MS = 60_000

export async function register() {
  // Only run in the Node.js server runtime (not edge).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Never start the scheduler during `next build`: register() still fires there,
  // and its async scheduler import racing the build's page-data worker can crash
  // it intermittently. We only want ticks under `next start` / `next dev`.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // Guard against double-registration on dev hot-reload.
  const g = globalThis as typeof globalThis & { __schedulerTimer?: NodeJS.Timeout }
  if (g.__schedulerTimer) return

  // Imported dynamically so Prisma/scheduler never get pulled into other runtimes.
  const { runDueSchedules } = await import('@/lib/scheduler')
  const { getSetting } = await import('@/lib/settings')

  const tick = async () => {
    try {
      const enabled = (await getSetting('scheduler_autotick_enabled', 'true')).toLowerCase()
      if (enabled === 'false' || enabled === '0' || enabled === 'off') return
      const { ran, errors } = await runDueSchedules()
      if (ran.length || errors.length) {
        console.log(`[scheduler] fired ${ran.length} run(s), ${errors.length} error(s)`)
      }
    } catch (e) {
      console.warn('[scheduler] tick failed:', e instanceof Error ? e.message : e)
    }
  }

  g.__schedulerTimer = setInterval(tick, TICK_INTERVAL_MS)
  // Don't keep the event loop alive solely for the timer.
  g.__schedulerTimer.unref?.()
  console.log('[scheduler] in-process auto-tick started (every 60s)')
}
