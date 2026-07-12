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
  F10: { color: 'bg-stone-200 text-stone-700' },
  F11: { color: 'bg-amber-100 text-amber-700' },
}

// Plain-language rendering of the compliance gate decision.
const DECISION_META: Record<string, { label: string; color: string }> = {
  pass:            { label: 'Checks passed',         color: 'bg-green-100 text-green-700' },
  route_to_review: { label: 'Needs your review',     color: 'bg-yellow-100 text-yellow-800' },
  block:           { label: 'Blocked by fact-check', color: 'bg-red-100 text-red-700' },
}

// Per-check rollups persisted on the ComplianceReport row (see prisma schema).
interface ComplianceSummary {
  decision: string
  summary: string
  caseSelectionOk: boolean
  corroboratedPct: number
  defamationFlags: number
  variationOk: boolean
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
  caseName?: string | null
  compliance?: ComplianceSummary | null
  footageSummary?: string | null
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
  caseName,
  compliance,
  footageSummary,
}: InboxCardProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishErr, setPublishErr] = useState<string | null>(null)
  const [permalink, setPermalink] = useState<string | null>(null)
  const tm = TYPE_META[factoryType] ?? { color: 'bg-gray-100 text-gray-600' }
  // F10 (True Crime) and F11 (History & Business) both surface the story/case
  // chip and compliance-gate chips instead of the sports moment/source line.
  const showsCase = factoryType === 'F10' || factoryType === 'F11'

  // Plain-language chips explaining WHY this video is sitting in review.
  const reviewChips: { label: string; color: string }[] = []
  if (compliance) {
    const dm = DECISION_META[compliance.decision] ?? {
      label: compliance.decision,
      color: 'bg-gray-100 text-gray-600',
    }
    reviewChips.push(dm)
    const pct = Math.round(compliance.corroboratedPct * 100)
    reviewChips.push({
      label: `${pct}% of key facts verified`,
      color: pct === 100 ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700',
    })
    if (compliance.defamationFlags > 0) {
      reviewChips.push({
        label: `${compliance.defamationFlags} risky wording flag${compliance.defamationFlags === 1 ? '' : 's'}`,
        color: 'bg-red-50 text-red-700',
      })
    }
    if (!compliance.caseSelectionOk) {
      reviewChips.push({ label: 'Case choice needs a second look', color: 'bg-yellow-50 text-yellow-700' })
    }
    if (!compliance.variationOk) {
      reviewChips.push({ label: 'Too similar to recent videos', color: 'bg-yellow-50 text-yellow-700' })
    }
  }

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
          {showsCase && caseName ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-stone-100 text-stone-700">
              {caseName}
            </span>
          ) : (
            strategy && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700">
                {strategy.replace(/_/g, ' ')}
              </span>
            )
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

      {compliance && (
        <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Review reasons
          </p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {reviewChips.map((chip) => (
              <span
                key={chip.label}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${chip.color}`}
              >
                {chip.label}
              </span>
            ))}
          </div>
          {compliance.summary && (
            <p className="text-xs text-gray-500 leading-relaxed">{compliance.summary}</p>
          )}
        </div>
      )}

      {footageSummary && (
        <p className="text-xs text-gray-400 mb-3">
          <span className="font-medium text-gray-500">Footage:</span> {footageSummary}
        </p>
      )}

      {!showsCase && (momentStart != null || sourceUrl) && (
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
