import Link from 'next/link'
import { Settings, Plus, Clock, BrainCircuit, Layers, Inbox } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { quotaStatus, describeAutoPublishFailure } from '@/lib/tools/publish'
import { HubNav } from '@/components/hub-nav'
import { AgentCard } from '@/components/agent-card'
import { InboxCard } from '@/components/inbox-card'
import { ScheduleCalendar } from '@/components/schedule-calendar'
import { WinnersView } from '@/components/winners-view'

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

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:      { label: 'Draft',      color: 'bg-gray-100 text-gray-600' },
  queued:     { label: 'Queued',     color: 'bg-blue-100 text-blue-600' },
  rendering:  { label: 'Rendering',  color: 'bg-amber-100 text-amber-700' },
  review:     { label: 'Review',     color: 'bg-yellow-100 text-yellow-700' },
  approved:   { label: 'Approved',   color: 'bg-emerald-100 text-emerald-700' },
  scheduled:  { label: 'Scheduled',  color: 'bg-sky-100 text-sky-700' },
  published:  { label: 'Published',  color: 'bg-green-100 text-green-700' },
  failed:     { label: 'Failed',     color: 'bg-red-100 text-red-600' },
}

export default async function Hub({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const activeTab = tab ?? 'overview'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Content Engine</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <Link
              href="/factories/new"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Factory
            </Link>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <HubNav activeTab={activeTab} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'factories' && <FactoriesTab />}
        {activeTab === 'agents' && <AgentsTab />}
        {activeTab === 'inbox' && <InboxTab />}
        {activeTab === 'queue' && <QueueTab />}
        {activeTab === 'schedule' && <ScheduleCalendar />}
        {activeTab === 'winners' && <WinnersView />}
      </main>
    </div>
  )
}

async function OverviewTab() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [totalVideos, thisMonthVideos, activeFactories, publishedCount, recentVideos, quota] =
    await Promise.all([
      prisma.video.count(),
      prisma.video.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.factory.count({ where: { archived: false } }),
      prisma.post.count({ where: { platform: 'youtube', status: 'published' } }),
      prisma.video.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          factory: { select: { name: true, type: true } },
          // A 'failed' YouTube Post means an auto-agent couldn't publish this
          // video (not connected / quota / rejected). Surface why, in plain
          // language, so it never silently sits in 'approved'.
          posts: {
            where: { platform: 'youtube', status: 'failed' },
            select: { error: true },
            take: 1,
          },
        },
      }),
      quotaStatus(),
    ])

  const stats = [
    {
      label: 'Total Videos',
      value: totalVideos.toString(),
      sub: `+${thisMonthVideos} this month`,
    },
    {
      label: 'This Month',
      value: thisMonthVideos.toString(),
      sub: `${thisMonthVideos === 0 ? '0 views' : `${thisMonthVideos} created`}`,
    },
    {
      label: 'Published',
      value: publishedCount.toString(),
      sub: `${quota.remaining}/${quota.cap} uploads left today`,
    },
    {
      label: 'Active Factories',
      value: activeFactories.toString(),
      sub: activeFactories === 0 ? 'None' : `${activeFactories} active`,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-lg border border-gray-200 p-5"
          >
            <p className="text-sm text-gray-500 mb-1">{s.label}</p>
            <p className="text-4xl font-bold text-gray-900 mb-1">{s.value}</p>
            <p className="text-sm text-gray-400">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <Clock className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Recent Activity</h2>
        </div>
        {recentVideos.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            No activity yet. Create a factory to get started.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentVideos.map((video) => {
              const tm = TYPE_META[video.factory.type] ?? {
                color: 'bg-gray-100 text-gray-600',
              }
              const sm = STATUS_META[video.status] ?? {
                label: video.status,
                color: 'bg-gray-100 text-gray-600',
              }
              const notPosted = video.posts[0]
              return (
                <div key={video.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${tm.color}`}
                      >
                        {video.factory.type}
                      </span>
                      <span className="text-sm text-gray-900 truncate">
                        {video.title ?? 'Untitled Video'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      {notPosted && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600">
                          Not posted
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.color}`}
                      >
                        {sm.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(video.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {notPosted && (
                    <p className="mt-1.5 text-xs text-red-600">
                      {describeAutoPublishFailure(notPosted.error)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

async function FactoriesTab() {
  const factories = await prisma.factory.findMany({
    where: { archived: false },
    include: { _count: { select: { videos: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Content Factories</h2>
        <Link
          href="/factories/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Factory
        </Link>
      </div>

      {factories.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-16 text-center">
          <p className="text-gray-600 mb-1">No factories yet.</p>
          <p className="text-sm text-gray-400 mb-6">
            Create your first factory to start generating videos.
          </p>
          <Link
            href="/factories/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Factory
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {factories.map((factory) => {
            const tm = TYPE_META[factory.type] ?? {
              color: 'bg-gray-100 text-gray-600',
            }
            const postingDefaults = factory.postingDefaults
              ? JSON.parse(factory.postingDefaults)
              : {}
            const config = factory.config ? JSON.parse(factory.config) : {}
            const autonomy = postingDefaults.autonomy ?? 'review'

            return (
              <div
                key={factory.id}
                className="bg-white rounded-lg border border-gray-200 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900">
                      {factory.name}
                    </h3>
                    {config.description && (
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {config.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ml-3 ${tm.color}`}
                  >
                    {factory.type}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{factory._count.videos} videos</span>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${
                      autonomy === 'auto'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-yellow-50 text-yellow-700'
                    }`}
                  >
                    {autonomy === 'auto' ? '⚡ auto' : '👁 review'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

async function AgentsTab() {
  const agents = await prisma.agent.findMany({
    include: {
      factory: { select: { id: true, name: true, type: true } },
      _count: { select: { runs: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Agents</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Each agent runs one factory independently, adapting from its analytics.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-16 text-center">
          <BrainCircuit className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 mb-1">No agents yet.</p>
          <p className="text-sm text-gray-400 mb-6">
            Create a factory first, then attach an agent to automate it.
          </p>
          <Link
            href="/agents/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              id={agent.id}
              name={agent.name}
              factoryId={agent.factory.id}
              factoryName={agent.factory.name}
              factoryType={agent.factory.type}
              autonomy={agent.autonomy}
              enabled={agent.enabled}
              budget={agent.budget}
              playbook={agent.playbook}
              runCount={agent._count.runs}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Friendly labels for the F10 footage-ladder tier keys stored in the
// 'footage-map' asset (see src/lib/truecrime/footage.ts TIERS).
const FOOTAGE_TIER_LABELS: Record<string, string> = {
  ai_still: 'AI still',
  stock: 'stock',
  archive: 'archive',
  moodbank: 'mood bank',
  placeholder: 'archive photo',
}

// "3× archive · 2× AI still · 1× mood bank" from a footage-map asset's meta.
// Returns null when there's no map or it can't be parsed (older/sports videos).
function footageSummaryFromMeta(meta: string | null): string | null {
  if (!meta) return null
  try {
    const parsed = JSON.parse(meta) as { footageSources?: Record<string, string> }
    const tiers = Object.values(parsed.footageSources ?? {})
    if (!tiers.length) return null
    const counts = new Map<string, number>()
    for (const tier of tiers) counts.set(tier, (counts.get(tier) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tier, n]) => `${n}× ${FOOTAGE_TIER_LABELS[tier] ?? tier}`)
      .join(' · ')
  } catch {
    return null
  }
}

async function InboxTab() {
  const pending = await prisma.video.findMany({
    where: { status: 'review' },
    orderBy: { createdAt: 'desc' },
    include: {
      factory: { select: { name: true, type: true } },
      highlightSources: true,
      complianceReports: { orderBy: { createdAt: 'desc' }, take: 1 },
      assets: { where: { kind: 'footage-map' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Review Inbox</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Videos generated by agents set to &quot;review&quot; mode — approve to schedule, reject to discard.
          </p>
        </div>
        {pending.length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold">
            {pending.length} pending
          </span>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-16 text-center">
          <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 mb-1">Inbox empty.</p>
          <p className="text-sm text-gray-400">
            Videos pending review will appear here when agents finish generating them.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((video) => {
            const report = video.complianceReports[0] ?? null
            return (
              <InboxCard
                key={video.id}
                id={video.id}
                title={video.title}
                scriptText={video.scriptText}
                factoryType={video.factory.type}
                factoryName={video.factory.name}
                costEstimate={video.costEstimate}
                createdAt={video.createdAt.toISOString()}
                hasMedia={Boolean(video.localPath)}
                strategy={video.highlightSources[0]?.strategy ?? null}
                sourceUrl={video.highlightSources[0]?.youtubeUrl ?? null}
                momentStart={video.highlightSources[0]?.momentStart ?? null}
                momentEnd={video.highlightSources[0]?.momentEnd ?? null}
                caseName={report?.caseName ?? null}
                compliance={
                  report
                    ? {
                        decision: report.decision,
                        summary: report.summary,
                        caseSelectionOk: report.caseSelectionOk,
                        corroboratedPct: report.corroboratedPct,
                        defamationFlags: report.defamationFlags,
                        variationOk: report.variationOk,
                      }
                    : null
                }
                footageSummary={footageSummaryFromMeta(video.assets[0]?.meta ?? null)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

async function QueueTab() {
  const jobs = await prisma.job.findMany({
    take: 30,
    orderBy: { createdAt: 'desc' },
    include: {
      video: { include: { factory: { select: { name: true, type: true } } } },
    },
  })

  const JOB_STATUS: Record<string, { label: string; color: string; dot: string }> = {
    pending:   { label: 'Pending',   color: 'text-gray-500',   dot: 'bg-gray-300' },
    running:   { label: 'Running',   color: 'text-blue-600',   dot: 'bg-blue-500' },
    done:      { label: 'Done',      color: 'text-green-600',  dot: 'bg-green-500' },
    completed: { label: 'Done',      color: 'text-green-600',  dot: 'bg-green-500' },
    failed:    { label: 'Failed',    color: 'text-red-600',    dot: 'bg-red-500' },
    cancelled: { label: 'Cancelled', color: 'text-gray-400',   dot: 'bg-gray-300' },
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Queue</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Per-stage job pipeline. Each video generation is a chain of jobs.
          </p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-16 text-center">
          <Layers className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 mb-1">No jobs yet.</p>
          <p className="text-sm text-gray-400">
            When an agent runs, each pipeline stage (script → tts → assemble → publish) appears here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {jobs.map((job) => {
              const tm = TYPE_META[job.video.factory.type] ?? {
                color: 'bg-gray-100 text-gray-600',
              }
              const jm = JOB_STATUS[job.status] ?? JOB_STATUS.pending
              return (
                <div
                  key={job.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${tm.color}`}
                    >
                      {job.video.factory.type}
                    </span>
                    <span className="text-sm font-mono text-gray-600 shrink-0">
                      {job.stage}
                    </span>
                    <span className="text-sm text-gray-400 truncate">
                      {job.video.title ?? job.videoId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${jm.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${jm.dot}`} />
                      {jm.label}
                    </span>
                    {job.error && (
                      <span className="text-xs text-red-500 truncate max-w-[200px]" title={job.error}>
                        {job.error}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
