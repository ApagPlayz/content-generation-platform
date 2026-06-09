'use client'

import Link from 'next/link'
import { ChevronLeft, Plus } from 'lucide-react'

export default function Factories() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 w-fit"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-900">Factories</h1>
            <Link
              href="/factories/new"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Factory
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
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
      </div>
    </div>
  )
}
