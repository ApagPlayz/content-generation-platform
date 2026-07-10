'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Loader2 } from 'lucide-react'

/**
 * Triggers a YouTube metrics refresh (POST /api/youtube/analytics), then
 * refreshes the server-rendered Winners leaderboard. Surfaces errors inline.
 */
export function RefreshMetricsButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/youtube/analytics', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={refresh}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {busy ? 'Refreshing…' : 'Refresh metrics'}
      </button>
    </div>
  )
}

export default RefreshMetricsButton
