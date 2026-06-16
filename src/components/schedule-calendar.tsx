import { CalendarClock, Clock, FileText } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { computeNextRun } from '@/lib/scheduler'
import { ScheduleManager } from './schedule-manager'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function dayLabel(d: Date): string {
  return `${DOW[d.getUTCDay()]} ${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}
function timeUTC(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

interface AgendaItem {
  at: Date
  kind: 'run' | 'post'
  label: string
  sub?: string
}

export async function ScheduleCalendar() {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [agents, schedules, posts] = await Promise.all([
    prisma.agent.findMany({
      include: { factory: { select: { type: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.schedule.findMany({
      include: { agent: { select: { name: true, enabled: true, factory: { select: { type: true } } } } },
      orderBy: { nextRunAt: 'asc' },
    }),
    prisma.post.findMany({
      where: {
        OR: [
          { scheduledFor: { gte: now, lte: windowEnd } },
          { publishedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
      include: { video: { select: { title: true } } },
      orderBy: { scheduledFor: 'asc' },
    }),
  ])

  // Project agent runs across the 7-day window from each enabled schedule.
  const items: AgendaItem[] = []
  for (const s of schedules) {
    if (!s.enabled || !s.agent.enabled) continue
    let cursor = s.nextRunAt && s.nextRunAt > now ? new Date(s.nextRunAt) : computeNextRun(s, now)
    let guard = 0
    while (cursor <= windowEnd && guard < 200) {
      if (cursor >= now) {
        items.push({
          at: new Date(cursor),
          kind: 'run',
          label: s.agent.name,
          sub: `${s.agent.factory.type} · ${s.cadence}`,
        })
      }
      cursor = computeNextRun(s, cursor)
      guard++
    }
  }
  for (const p of posts) {
    const at = p.scheduledFor ?? p.publishedAt
    if (!at) continue
    items.push({
      at: new Date(at),
      kind: 'post',
      label: p.video.title ?? 'Untitled video',
      sub: `${p.platform} · ${p.publishedAt ? 'published' : 'scheduled'}`,
    })
  }

  items.sort((a, b) => a.at.getTime() - b.at.getTime())

  // Group into the next 7 UTC days.
  const days: { key: string; label: string; items: AgendaItem[] }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
    days.push({ key: dayKey(d), label: i === 0 ? `Today · ${dayLabel(d)}` : dayLabel(d), items: [] })
  }
  const dayIndex = new Map(days.map((d, i) => [d.key, i]))
  for (const it of items) {
    const idx = dayIndex.get(dayKey(it.at))
    if (idx !== undefined) days[idx].items.push(it)
  }

  // Serializable props for the client manager.
  const agentProps = agents.map((a) => ({
    id: a.id,
    name: a.name,
    factoryType: a.factory.type,
    enabled: a.enabled,
  }))
  const scheduleProps = schedules.map((s) => ({
    id: s.id,
    agentId: s.agentId,
    agentName: s.agent.name,
    factoryType: s.agent.factory.type,
    cadence: s.cadence,
    hourUTC: s.hourUTC,
    minuteUTC: s.minuteUTC,
    dayOfWeek: s.dayOfWeek,
    enabled: s.enabled,
    nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
  }))

  const hasSchedules = schedules.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Schedule</h2>
        <p className="text-sm text-gray-500 mt-1">
          Automate agent runs on a cadence. The app has no background worker, so hit the tick
          endpoint (cron) or &quot;Run due now&quot;.
        </p>
      </div>

      {!hasSchedules ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <CalendarClock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600 font-medium">No schedules yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Add one below to run an agent automatically on an hourly, daily, or weekly cadence.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="w-4 h-4 text-gray-400" />
            <h3 className="font-semibold text-gray-900">Next 7 days</h3>
          </div>
          <div className="space-y-4">
            {days.map((day) => (
              <div key={day.key}>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                  {day.label}
                </div>
                {day.items.length === 0 ? (
                  <div className="text-sm text-gray-300 pl-6">Nothing scheduled</div>
                ) : (
                  <div className="space-y-1.5">
                    {day.items.map((it, i) => (
                      <div key={i} className="flex items-center gap-2 pl-1 text-sm">
                        {it.kind === 'run' ? (
                          <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        )}
                        <span className="text-gray-400 tabular-nums w-20 shrink-0">
                          {timeUTC(it.at)}
                        </span>
                        <span className="text-gray-900 truncate">{it.label}</span>
                        {it.sub && <span className="text-xs text-gray-400 shrink-0">{it.sub}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ScheduleManager agents={agentProps} schedules={scheduleProps} />
    </div>
  )
}

export default ScheduleCalendar
