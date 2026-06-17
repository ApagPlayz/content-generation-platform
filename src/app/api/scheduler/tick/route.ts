import { NextResponse } from 'next/server'
import { runDueSchedules } from '@/lib/scheduler'

/**
 * Tick endpoint. The app has no background worker/daemon, so something external
 * must drive the scheduler: point a cron job (e.g. `curl -X POST .../api/scheduler/tick`
 * every minute) at this route, or use the dashboard "Run due now" button. Each
 * call fires every schedule whose nextRunAt is due and advances their nextRunAt.
 *
 * Auth: if SCHEDULER_SECRET is set, the request must either present
 * `Authorization: Bearer <secret>` (how the cron job calls it) or be a same-origin
 * browser request (how the dashboard "Run due now" button calls it — browsers send
 * `Sec-Fetch-Site: same-origin`, which a cross-origin/scripted caller can't forge
 * from a real browser context). If SCHEDULER_SECRET is unset the route stays open,
 * preserving the zero-config dev experience.
 */
export async function POST(req: Request) {
  const secret = process.env.SCHEDULER_SECRET
  if (secret) {
    const bearer = req.headers.get('authorization') === `Bearer ${secret}`
    const sameOrigin = req.headers.get('sec-fetch-site') === 'same-origin'
    if (!bearer && !sameOrigin) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  const result = await runDueSchedules()
  return NextResponse.json(result)
}
