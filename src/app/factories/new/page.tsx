'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Loader2 } from 'lucide-react'

const FACTORY_TYPES = [
  { id: 'F1', name: 'Reddit Stories',  desc: 'Narration over b-roll' },
  { id: 'F2', name: 'Music Reviews',   desc: 'Album reactions and music news' },
  { id: 'F3', name: 'Show Clips',      desc: 'Repackaged TV/movie moments' },
  { id: 'F4', name: 'Streamer Clips',  desc: 'Twitch/YouTube clip compilations' },
  { id: 'F5', name: 'Listicles',       desc: 'Top 5, countdown-style videos' },
  { id: 'F6', name: 'AI Cinematic',    desc: 'Text-to-video generation' },
  { id: 'F7', name: 'Image-to-Video',  desc: 'AI-animated stills' },
  { id: 'F8', name: 'AI Avatar',       desc: 'Talking head presenter' },
  // F9 = Sports Highlights — owned by the other agent instance; it adds its own selector entry.
  { id: 'F10', name: 'True Crime',     desc: 'Narrated dark history & real cases' },
  { id: 'F11', name: 'History & Business Mini-Docs', desc: 'Faceless mini-documentaries on historical events and business rises, falls & scandals' },
]

export default function NewFactory() {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null)
  const [step, setStep] = useState<'select' | 'configure'>('select')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [ctaBlock, setCtaBlock] = useState('')
  const [autonomy, setAutonomy] = useState<'review' | 'auto'>('review')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedType = FACTORY_TYPES.find((t) => t.id === selected)

  async function handleCreate() {
    if (!selected || !name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/factories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type: selected,
          description: description.trim(),
          autonomy,
          ctaBlock: ctaBlock.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create factory')
      }
      router.push('/?tab=factories')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <Link
            href="/?tab=factories"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 w-fit transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Factories
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === 'select' ? 'Choose Factory Type' : 'Configure Factory'}
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {step === 'select' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FACTORY_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelected(type.id)}
                  className={`p-5 rounded-lg border-2 text-left transition-all ${
                    selected === type.id
                      ? 'border-gray-900 bg-white shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-semibold text-gray-900">{type.name}</h3>
                    <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0 ml-2">
                      {type.id}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{type.desc}</p>
                </button>
              ))}
            </div>

            <div className="flex gap-3 justify-end mt-8">
              <Link
                href="/?tab=factories"
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
              <button
                onClick={() => setStep('configure')}
                disabled={!selected}
                className="px-5 py-2.5 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 'configure' && (
          <div className="max-w-2xl space-y-5">
            <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
              <h2 className="font-semibold text-gray-900">Factory Details</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Type
                </label>
                <div className="px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700">
                  {selectedType?.name}{' '}
                  <span className="text-gray-400 font-mono text-xs">
                    ({selected})
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Factory Name{' '}
                  <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g., Daily ${selectedType?.name}`}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Description{' '}
                  <span className="text-gray-400 text-xs">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What will this factory produce?"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Links / call-to-action{' '}
                  <span className="text-gray-400 text-xs">(optional)</span>
                </label>
                <textarea
                  value={ctaBlock}
                  onChange={(e) => setCtaBlock(e.target.value)}
                  placeholder={'👉 Subscribe: https://youtube.com/@yourchannel\n🛒 My gear: https://...'}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
                />
                <p className="text-xs text-gray-400 mt-2">
                  Added to the end of every published video&apos;s YouTube description —
                  so the channel can earn affiliate income before it&apos;s monetized.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Autonomy Mode
                </label>
                <div className="flex gap-3">
                  {(['review', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAutonomy(mode)}
                      className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        autonomy === mode
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {mode === 'review' ? '👁 Review before posting' : '⚡ Auto-post'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {autonomy === 'review'
                    ? 'Generated videos go to your review inbox before posting.'
                    : 'Videos are automatically posted after generation. Use with caution.'}
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setStep('select')}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Factory
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
