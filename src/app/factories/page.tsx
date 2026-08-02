'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus, Bot, Film } from 'lucide-react'

interface Factory {
  id: string
  name: string
  type: string
  config: string
  createdAt: string
  _count: { videos: number }
}

export default function Factories() {
  const [factories, setFactories] = useState<Factory[] | null>(null)

  useEffect(() => {
    fetch('/api/factories')
      .then((r) => r.json())
      .then(setFactories)
      .catch(() => setFactories([]))
  }, [])

  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Factories</h1>
          <Link
            href="/factories/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Factory
          </Link>
        </div>

        {factories === null ? (
          <p className="text-slate-500">Loading…</p>
        ) : factories.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
            <p className="text-slate-600 mb-4">No factories yet.</p>
            <p className="text-sm text-slate-500 mb-6">
              Create your first factory to start generating videos.
            </p>
            <Link
              href="/factories/new"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Factory
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {factories.map((f) => {
              const config = safeParse(f.config)
              return (
                <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-6">
                  <div className="flex items-start justify-between mb-2">
                    <h2 className="text-lg font-semibold text-slate-900">{f.name}</h2>
                    <span className="text-xs font-mono px-2 py-1 rounded bg-slate-100 text-slate-600">
                      {f.type}
                    </span>
                  </div>
                  {config.description ? (
                    <p className="text-sm text-slate-600 mb-4">{String(config.description)}</p>
                  ) : null}
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <Film className="w-4 h-4" /> {f._count.videos} videos
                    </span>
                    <Link
                      href="/?tab=studio"
                      className="flex items-center gap-1 text-slate-700 hover:text-slate-900"
                    >
                      <Bot className="w-4 h-4" /> Manage agents
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}
