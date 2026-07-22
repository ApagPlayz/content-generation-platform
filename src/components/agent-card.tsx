'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Eye, Play, Trash2, Power, Sparkles, BrainCircuit } from 'lucide-react'

const TYPE_META: Record<string, { color: string }> = {
  F1: { color: 'bg-orange-100 text-orange-700' },
  F2: { color: 'bg-purple-100 text-purple-700' },
  F3: { color: 'bg-blue-100 text-blue-700' },
  F4: { color: 'bg-green-100 text-green-700' },
  F5: { color: 'bg-yellow-100 text-yellow-700' },
  F6: { color: 'bg-pink-100 text-pink-700' },
  F7: { color: 'bg-cyan-100 text-cyan-700' },
  F8: { color: 'bg-rose-100 text-rose-700' },
  F9: { color: 'bg-indigo-100 text-indigo-700' },
  F10: { color: 'bg-stone-200 text-stone-700' },
  F11: { color: 'bg-amber-100 text-amber-700' },
}

interface AgentCardProps {
  id: string
  name: string
  factoryId: string
  factoryName: string
  factoryType: string
  autonomy: string
  enabled: boolean
  budget: number | null
  playbook: string
  memory: string | null
  runCount: number
}

export function AgentCard({
  id,
  name,
  factoryType,
  factoryName,
  autonomy: initialAutonomy,
  enabled: initialEnabled,
  budget,
  playbook,
  memory,
  runCount,
}: AgentCardProps) {
  const router = useRouter()
  const [autonomy, setAutonomy] = useState(initialAutonomy)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)

  const tm = TYPE_META[factoryType] ?? { color: 'bg-gray-100 text-gray-600' }

  async function patch(data: Record<string, unknown>) {
    setBusy(true)
    await fetch(`/api/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setBusy(false)
    router.refresh()
  }

  async function toggleAutonomy() {
    const next = autonomy === 'review' ? 'auto' : 'review'
    setAutonomy(next)
    await patch({ autonomy: next })
  }

  async function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    await patch({ enabled: next })
  }

  async function runNow() {
    setRunning(true)
    await fetch(`/api/agents/${id}/run`, { method: 'POST' })
    // Pipeline runs in background (download + render can take minutes);
    // the Queue tab shows per-stage progress.
    setTimeout(() => {
      setRunning(false)
      router.refresh()
    }, 1500)
  }

  async function deleteAgent() {
    if (!confirm(`Delete agent "${name}"? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <div
      className={`bg-white rounded-lg border p-5 transition-opacity ${
        enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${tm.color}`}>
            {factoryType}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 leading-tight">{name}</p>
            <p className="text-xs text-gray-400 truncate">{factoryName}</p>
          </div>
        </div>

        <button
          onClick={toggleEnabled}
          disabled={busy}
          title={enabled ? 'Disable agent' : 'Enable agent'}
          className={`ml-3 shrink-0 p-1.5 rounded-md transition-colors ${
            enabled
              ? 'text-green-600 hover:bg-green-50'
              : 'text-gray-400 hover:bg-gray-100'
          }`}
        >
          <Power className="w-4 h-4" />
        </button>
      </div>

      {/* Playbook preview */}
      <p className="text-xs text-gray-500 line-clamp-2 mb-4 leading-relaxed">
        {playbook}
      </p>

      {/* What's winning — the analytics feedback loop (Agent.memory). Shows the
          owner WHY the agent will make what it makes next. Empty until videos
          publish and metrics refresh. */}
      {memory?.trim() ? (
        <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 mb-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="text-xs font-medium text-amber-800">What&apos;s winning</span>
          </div>
          <p className="text-xs text-amber-900/80 leading-relaxed whitespace-pre-line line-clamp-4">
            {memory.trim()}
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2 mb-4">
          <div className="flex items-center gap-1.5">
            <BrainCircuit className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-400 leading-relaxed">
              No winners learned yet — fills in once videos publish and metrics refresh.
            </span>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
        <span>{runCount} runs</span>
        {budget != null && <><span>·</span><span>${budget}/run cap</span></>}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between">
        <button
          onClick={toggleAutonomy}
          disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            autonomy === 'auto'
              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
              : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'
          }`}
        >
          {autonomy === 'auto' ? (
            <><Zap className="w-3.5 h-3.5" /> Auto-post</>
          ) : (
            <><Eye className="w-3.5 h-3.5" /> Review gate</>
          )}
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={runNow}
            disabled={!enabled || busy || running}
            title="Run agent now"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> {running ? 'Starting…' : 'Run'}
          </button>
          <button
            onClick={deleteAgent}
            disabled={deleting}
            title="Delete agent"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
