'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default function Settings() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 w-fit"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Platform Authentication</h2>
            <p className="text-slate-600 text-sm mb-4">
              Connect your TikTok, Instagram, and YouTube accounts for auto-publishing.
            </p>
            <div className="space-y-3">
              {['TikTok', 'Instagram Reels', 'YouTube'].map((platform) => (
                <div
                  key={platform}
                  className="flex items-center justify-between p-4 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{platform}</span>
                  <button className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors">
                    Connect
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">API Keys & Budget</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Monthly Budget (USD)
                </label>
                <input
                  type="number"
                  placeholder="50"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
