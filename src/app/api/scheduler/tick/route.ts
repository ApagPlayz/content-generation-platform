import { NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/scheduler'

/**
 * Tick endpoint. The app has no background worker/daemon, so something external
 * must drive the scheduler: point a cron job (e.g. `curl -X POST .../api/scheduler/tick`
 * every minute) at this route, or use the dashboard "Run due now" button. Each
 * call fires every schedule whose nextRunAt is due and advances their nextRunAt.
 */
export async function POST() {
  const result = await runDueSchedules()
  return NextResponse.json(result)
}
