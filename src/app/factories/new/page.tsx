'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

const FACTORY_TYPES = [
  { id: 'F1', name: 'Reddit Stories', desc: 'Narration over b-roll' },
  { id: 'F2', name: 'Music Reviews', desc: 'Album reactions and music news' },
  { id: 'F3', name: 'Show Clips', desc: 'Repackaged TV/movie moments' },
  { id: 'F4', name: 'Streamer Clips', desc: 'Twitch/YouTube clip compilations' },
  { id: 'F5', name: 'Listicles', desc: 'Top 5, countdown-style videos' },
  { id: 'F6', name: 'AI Cinematic', desc: 'Text-to-video generation' },
  { id: 'F7', name: 'Image-to-Video', desc: 'AI-animated stills' },
  { id: 'F8', name: 'AI Avatar', desc: 'Talking head presenter' },
]

export default function NewFactory() {
  const [selected, setSelected] = useState<string | null>(null)
  const [step, setStep] = useState<'select' | 'configure'>('select')

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link
            href="/factories"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 w-fit"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Factories
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">
            {step === 'select' ? 'Choose Factory Type' : 'Configure Factory'}
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {step === 'select' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FACTORY_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelected(type.id)}
                className={`p-6 rounded-lg border-2 text-left transition-all ${
                  selected === type.id
                    ? 'border-slate-900 bg-slate-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900">{type.name}</h3>
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                    {type.id}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{type.desc}</p>
              </button>
            ))}
          </div>
        )}

        {step === 'select' && (
          <div className="flex gap-3 justify-end mt-8">
            <Link
              href="/factories"
              className="px-6 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              onClick={() => setStep('configure')}
              disabled={!selected}
              className="px-6 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'configure' && (
          <div className="max-w-2xl space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Factory Details</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Factory Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Daily Reddit Stories"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Type
                  </label>
                  <div className="px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-600">
                    {FACTORY_TYPES.find((t) => t.id === selected)?.name}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    placeholder="What will this factory produce?"
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setStep('select')}
                className="px-6 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <Link
                href="/factories"
                className="px-6 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                Create Factory
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
