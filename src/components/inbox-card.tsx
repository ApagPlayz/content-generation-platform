'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Youtube, Loader2, ExternalLink } from 'lucide-react'

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
}

interface InboxCardProps {
  id: string
  title: string | null
  scriptText: string | null
  factoryType: string
  factoryName: string
  costEstimate: number | null
  createdAt: string
  hasMedia?: boolean
  strategy?: string | null
  sourceUrl?: string | null
  momentStart?: number | null
  momentEnd?: number | null
}

export function InboxCard({
  id,
  title,
  scriptText,
  factoryType,
  factoryName,
  costEstimate,
  createdAt,
  hasMedia,
  strategy,
  sourceUrl,
  momentStart,
  momentEnd,
}: InboxCardProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishErr, setPublishErr] = useState<string | null>(null)
  const [permalink, setPermalink] = useState<string | null>(null)
  const tm = TYPE_META[factoryType] ?? { color: 'bg-gray-100 text-gray-600' }

  async function setStatus(status: string) {
    setBusy(true)
    await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    router.refresh()
  }

  async function publish() {
    setPublishing(true)
    setPublishErr(null)
    try {
      const res = await fetch(`/api/videos/${id}/publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      setPermalink(data.permalink)
      router.refresh()
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const timeAgo = (() => {
    const diffMs = Date.now() - new Date(createdAt).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  })()

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex gap-5">
      {hasMedia && (
        <div className="shrink-0 w-40 rounded-lg overflow-hidden bg-black self-start">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={`/api/media/${id}`} controls className="w-full aspect-[9/16] object-contain" />
        </div>
      )}
      <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tm.color}`}>
            {factoryType}
          </span>
          <span className="text-xs text-gray-400">{factoryName}</span>
          {strategy && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700">
              {strategy.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0 ml-3">
          {costEstimate != null && <span>${costEstimate.toFixed(3)}</span>}
          <span>{timeAgo}</span>
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 mb-2">
        {title ?? 'Untitled Video'}
      </h3>

      {scriptText && (
        <p className="text-sm text-gray-500 line-clamp-3 mb-4 leading-relaxed">
          {scriptText}
        </p>
      )}

      {(momentStart != null || sourceUrl) && (
        <p className="text-xs text-gray-400 mb-3">
          {momentStart != null && `Moment ${momentStart}s–${momentEnd}s`}
          {momentStart != null && sourceUrl && ' · '}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-gray-600">
              source video
            </a>
          )}
        </p>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <button
          onClick={() => setStatus('approved')}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>
        {hasMedia && (
          permalink ? (
            <a
              href={permalink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-green-300 bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on YouTube
            </a>
          ) : (
            <button
              onClick={publish}
              disabled={publishing || busy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Youtube className="w-4 h-4" />
              )}
              {publishing ? 'Publishing…' : 'Publish to YouTube'}
            </button>
          )
        )}
        <button
          onClick={() => setStatus('draft')}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
        {publishErr && <span className="text-xs text-red-600 ml-1">{publishErr}</span>}
      </div>
      </div>
    </div>
  )
}
