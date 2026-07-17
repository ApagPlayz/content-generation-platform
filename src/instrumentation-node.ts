// Node-only scheduler bootstrap, kept in its own module so it is imported ONLY
// from the `process.env.NEXT_RUNTIME === 'nodejs'` branch in instrumentation.ts.
// That branch is a compile-time constant per bundle, so Next's edge/client
// compilers dead-code-eliminate this import entirely — which matters because
// the pipeline this pulls in (googleapis, ffmpeg, Remotion, child_process) is
// node-only and cannot be compiled for the edge runtime.
//
// A lightweight interval drives the in-process scheduler so the app needs no
// external cron. The external /api/scheduler/tick route still works (for
// redundancy or cron), and runDueSchedules advances nextRunAt before firing, so
// an overlapping external tick won't double-run a schedule.
//
// Controlled by the `scheduler_autotick_enabled` setting (default ON). Turn it
// off in Settings if you'd rather drive ticks externally.

const TICK_INTERVAL_MS = 60_000

export async function startScheduler(): Promise<void> {
  // Guard against double-registration on dev hot-reload. `__lastMetricsRefreshAt`
  // is the in-process throttle stamp for the hourly metrics auto-refresh below.
  const g = globalThis as typeof globalThis & {
    __schedulerTimer?: NodeJS.Timeout
    __lastMetricsRefreshAt?: number
  }
  if (g.__schedulerTimer) return

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

      // Keep the Winners leaderboard fresh without a human clicking "Refresh
      // metrics" (issue #50). Throttled to once an hour so it doesn't burn the
      // YouTube Analytics quota. We stamp BEFORE awaiting so a slow or failing
      // refresh (e.g. a lapsed YouTube login) backs off a full hour instead of
      // retrying every 60s; its own try/catch keeps a metrics failure from
      // touching the scheduler tick.
      const { shouldAutoRefresh } = await import('@/lib/metrics-refresh')
      if (shouldAutoRefresh(Date.now(), g.__lastMetricsRefreshAt)) {
        g.__lastMetricsRefreshAt = Date.now()
        try {
          const { refreshAllMetrics } = await import('@/lib/tools/analytics')
          const { updated } = await refreshAllMetrics()
          if (updated) console.log(`[analytics] auto-refreshed ${updated} video(s)`)
        } catch (e) {
          console.warn('[analytics] auto-refresh failed:', e instanceof Error ? e.message : e)
        }
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
