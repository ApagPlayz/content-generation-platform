import { ExternalLink, Trophy } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PLATFORM, connection } from '@/lib/youtube'
import { latestMetricsByPost } from '@/lib/tools/analytics'
import { RefreshMetricsButton } from './refresh-metrics-button'

// Factory-type badge colors (mirrors the inbox-card convention).
const TYPE_COLOR: Record<string, string> = {
  F9: 'bg-indigo-100 text-indigo-700',
}

function typeColor(type: string | undefined): string {
  return (type && TYPE_COLOR[type]) || 'bg-gray-100 text-gray-600'
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString()
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Trophy className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500 max-w-md">{message}</p>
      </div>
    </div>
  )
}

/**
 * Winners leaderboard (PRD Phase 2 analytics). Ranks published YouTube Shorts by
 * latest view count and shows likes, comments, and an engagement rate.
 */
export async function WinnersView() {
  const conn = await connection()

  const posts = await prisma.post.findMany({
    where: { platform: PLATFORM, status: 'published' },
    include: { video: { include: { factory: true } } },
  })

  const header = (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Winners</h2>
        <p className="text-sm text-gray-500">Top published videos by views.</p>
      </div>
      <RefreshMetricsButton />
    </div>
  )

  if (!conn) {
    return (
      <div>
        {header}
        <EmptyState message="Connect YouTube in Settings to publish videos and track their performance here." />
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div>
        {header}
        <EmptyState message="No published videos yet. Once you publish a video and refresh metrics, the top performers will appear here." />
      </div>
    )
  }

  const latest = await latestMetricsByPost()

  const rows = posts
    .map((post) => {
      const metric = latest.get(post.id)
      const views = metric?.views ?? 0
      const likes = metric?.likes ?? 0
      const comments = metric?.comments ?? 0
      const engagement = views > 0 ? (likes + comments) / views : 0
      return {
        id: post.id,
        title: post.video?.title ?? 'Untitled Video',
        factoryType: post.video?.factory?.type,
        permalink:
          post.permalink ||
          (post.platformPostId ? `https://youtube.com/watch?v=${post.platformPostId}` : null),
        views,
        likes,
        comments,
        engagement,
      }
    })
    .sort((a, b) => b.views - a.views)

  return (
    <div>
      {header}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
              <th className="px-5 py-3 font-medium">#</th>
              <th className="px-5 py-3 font-medium">Video</th>
              <th className="px-5 py-3 font-medium text-right">Views</th>
              <th className="px-5 py-3 font-medium text-right">Likes</th>
              <th className="px-5 py-3 font-medium text-right">Comments</th>
              <th className="px-5 py-3 font-medium text-right">Engagement</th>
              <th className="px-5 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${typeColor(
                        row.factoryType
                      )}`}
                    >
                      {row.factoryType ?? '—'}
                    </span>
                    <span className="font-medium text-gray-900 truncate">{row.title}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-900">{fmt(row.views)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-500">{fmt(row.likes)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-500">
                  {fmt(row.comments)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-gray-500">
                  {(row.engagement * 100).toFixed(1)}%
                </td>
                <td className="px-5 py-3 text-right">
                  {row.permalink && (
                    <a
                      href={row.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default WinnersView
