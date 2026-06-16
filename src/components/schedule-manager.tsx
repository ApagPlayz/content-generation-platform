'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Plus, Trash2, Play, Loader2 } from 'lucide-react'

interface AgentOption {
  id: string
  name: string
  factoryType: string
  enabled: boolean
}

interface ScheduleRow {
  id: string
  agentId: string
  agentName: string
  factoryType: string
  cadence: string
  hourUTC: number | null
  minuteUTC: number
  dayOfWeek: number | null
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
}

interface ScheduleManagerProps {
  agents: AgentOption[]
  schedules: ScheduleRow[]
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

function describeCadence(s: ScheduleRow): string {
  const time = `${pad(s.hourUTC ?? 12)}:${pad(s.minuteUTC)} UTC`
  if (s.cadence === 'hourly') return `Hourly at :${pad(s.minuteUTC)} UTC`
  if (s.cadence === 'weekly') return `Weekly on ${DOW[s.dayOfWeek ?? 1]} at ${time}`
  return `Daily at ${time}`
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())} UTC`
}

export function ScheduleManager({ agents, schedules }: ScheduleManagerProps) {
  const router = useRouter()
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [cadence, setCadence] = useState('daily')
  const [hourUTC, setHourUTC] = useState(12)
  const [minuteUTC, setMinuteUTC] = useState(0)
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tickBusy, setTickBusy] = useState(false)
  const [tickMsg, setTickMsg] = useState<string | null>(null)

  async function addSchedule() {
    if (!agentId) return
    setAdding(true)
    setAddErr(null)
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          cadence,
          hourUTC: cadence === 'hourly' ? null : hourUTC,
          minuteUTC,
          dayOfWeek: cadence === 'weekly' ? dayOfWeek : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add schedule')
      router.refresh()
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Failed to add schedule')
    } finally {
      setAdding(false)
    }
  }

  async function toggle(s: ScheduleRow) {
    setBusyId(s.id)
    await fetch(`/api/schedules/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    })
    setBusyId(null)
    router.refresh()
  }

  async function remove(s: ScheduleRow) {
    setBusyId(s.id)
    await fetch(`/api/schedules/${s.id}`, { method: 'DELETE' })
    setBusyId(null)
    router.refresh()
  }

  async function runDueNow() {
    setTickBusy(true)
    setTickMsg(null)
    try {
      const res = await fetch('/api/scheduler/tick', { method: 'POST' })
      const data: { ran?: string[]; errors?: unknown[] } = await res.json()
      const ran = data.ran?.length ?? 0
      const errs = data.errors?.length ?? 0
      setTickMsg(`Ran ${ran} schedule${ran === 1 ? '' : 's'}${errs ? `, ${errs} error(s)` : ''}.`)
      router.refresh()
    } catch {
      setTickMsg('Tick failed.')
    } finally {
      setTickBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Add schedule */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Add schedule</h3>
          <button
            onClick={runDueNow}
            disabled={tickBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {tickBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run due now
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 min-w-44"
            >
              {agents.length === 0 && <option value="">No agents</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.enabled}>
                  {a.name} ({a.factoryType}){a.enabled ? '' : ' — paused'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Cadence
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>

          {cadence === 'weekly' && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Day
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              >
                {DOW.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}

          {cadence !== 'hourly' && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Hour UTC
              <select
                value={hourUTC}
                onChange={(e) => setHourUTC(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {pad(h)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Minute UTC
            <select
              value={minuteUTC}
              onChange={(e) => setMinuteUTC(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              {[0, 5, 10, 15, 20, 30, 40, 45, 50].map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={addSchedule}
            disabled={adding || !agentId}
            className="flex items-center gap-1.5 rounded-lg bg-gray-900 text-white text-sm font-semibold px-4 py-2 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add schedule
          </button>
        </div>
        {addErr && <p className="text-xs text-red-600 mt-2">{addErr}</p>}
        {tickMsg && <p className="text-xs text-gray-500 mt-2">{tickMsg}</p>}
      </div>

      {/* Existing schedules */}
      {schedules.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Active schedules</h3>
          <div className="divide-y divide-gray-100">
            {schedules.map((s) => (
              <div key={s.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm truncate">{s.agentName}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {s.factoryType}
                    </span>
                    {!s.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                        paused
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {describeCadence(s)} · next {formatWhen(s.nextRunAt)}
                  </div>
                </div>
                <button
                  onClick={() => toggle(s)}
                  disabled={busyId === s.id}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => remove(s)}
                  disabled={busyId === s.id}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  aria-label="Delete schedule"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
