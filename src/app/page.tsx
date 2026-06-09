'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Settings, BarChart3 } from 'lucide-react'

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'factories' | 'videos'>('overview')

  return (
    <main className="flex-1">
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-slate-900">Content Engine</h1>
            <div className="flex gap-3">
              <Link
                href="/settings"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Settings
              </Link>
              <Link
                href="/factories/new"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Factory
              </Link>
            </div>
          </div>

          <div className="flex gap-1 border-b border-slate-200">
            {(['overview', 'factories', 'videos'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Videos', value: '0', trend: '+0' },
                { label: 'This Month', value: '0', trend: '0 views' },
                { label: 'Revenue YTD', value: '$0', trend: '+$0' },
                { label: 'Active Factories', value: '0', trend: 'None' },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-6">
                  <p className="text-sm font-medium text-slate-600 mb-2">{card.label}</p>
                  <p className="text-3xl font-bold text-slate-900 mb-1">{card.value}</p>
                  <p className="text-xs text-slate-500">{card.trend}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-slate-600" />
                <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
              </div>
              <p className="text-slate-600">No activity yet. Create a factory to get started.</p>
            </div>
          </div>
        )}

        {activeTab === 'factories' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-900">Content Factories</h2>
              <Link
                href="/factories/new"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Factory
              </Link>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
              <p className="text-slate-600 mb-4">No factories yet.</p>
              <p className="text-sm text-slate-500">
                Create your first factory to start generating videos.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'videos' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Videos</h2>
            <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
              <p className="text-slate-600 mb-4">No videos yet.</p>
              <p className="text-sm text-slate-500">
                Generate your first video from a factory.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
