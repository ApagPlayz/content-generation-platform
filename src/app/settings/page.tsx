'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Eye, EyeOff, Check, Loader2 } from 'lucide-react'

interface SettingsMap {
  anthropic_api_key?: string
  monthly_budget?: string
  default_tts_provider?: string
  default_image_provider?: string
  default_model_tier?: string
}

const PROVIDERS_TTS = ['elevenlabs', 'openai-tts', 'coqui-local', 'edge-tts']
const PROVIDERS_IMAGE = ['dall-e-3', 'flux', 'stable-diffusion-local']
const MODEL_TIERS = ['haiku', 'sonnet', 'opus']

export default function Settings() {
  const [settings, setSettings] = useState<SettingsMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: SettingsMap) => setSettings(data))
      .finally(() => setLoading(false))
  }, [])

  function set(key: keyof SettingsMap, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 w-fit transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Hub
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : saved ? (
                <><Check className="w-4 h-4" /> Saved</>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Claude / Anthropic */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-gray-900">Claude API</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Used for scripting, ideation, and agent decision-making.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Anthropic API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.anthropic_api_key ?? ''}
                onChange={(e) => set('anthropic_api_key', e.target.value)}
                placeholder="sk-ant-api03-…"
                className="w-full pr-10 pl-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Stored locally in SQLite. Never sent anywhere except Anthropic&apos;s API.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Default model tier
            </label>
            <div className="flex gap-2">
              {MODEL_TIERS.map((tier) => (
                <button
                  key={tier}
                  onClick={() => set('default_model_tier', tier)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-all ${
                    (settings.default_model_tier ?? 'sonnet') === tier
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <p className="text-xs text-gray-400 text-center">
                $1/1M — bulk scripts
              </p>
              <p className="text-xs text-gray-400 text-center">
                $3/1M — recommended
              </p>
              <p className="text-xs text-gray-400 text-center">
                $15/1M — creative work
              </p>
            </div>
          </div>
        </section>

        {/* Budget */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">Budget</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Alerts when monthly spend approaches the ceiling.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Monthly ceiling (USD)
            </label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                $
              </span>
              <input
                type="number"
                value={settings.monthly_budget ?? ''}
                onChange={(e) => set('monthly_budget', e.target.value)}
                placeholder="50"
                min="0"
                step="10"
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Lean tier ≈ $30–50/mo. Moderate tier ≈ $100–200/mo. See the cost guide in docs/ for details.
            </p>
          </div>
        </section>

        {/* Providers */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-gray-900">Default Providers</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Per-agent overrides take precedence. These are the defaults when no override is set.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Text-to-Speech
            </label>
            <select
              value={settings.default_tts_provider ?? ''}
              onChange={(e) => set('default_tts_provider', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
            >
              <option value="">Not set</option>
              {PROVIDERS_TTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Image Generation
            </label>
            <select
              value={settings.default_image_provider ?? ''}
              onChange={(e) => set('default_image_provider', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
            >
              <option value="">Not set</option>
              {PROVIDERS_IMAGE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Platform Auth */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="mb-4">
            <h2 className="font-semibold text-gray-900">Platform Authentication</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              OAuth connections for auto-publishing. YouTube is easiest to set up first.
            </p>
          </div>
          <div className="space-y-3">
            {[
              { label: 'YouTube Shorts', note: 'Data API v3 · ~6 uploads/day default quota', ready: true },
              { label: 'Instagram Reels', note: 'Requires Business account + Meta App Review', ready: false },
              { label: 'TikTok', note: 'Requires posting-scope approval + audit for public posts', ready: false },
            ].map((platform) => (
              <div
                key={platform.label}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{platform.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{platform.note}</p>
                </div>
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    platform.ready
                      ? 'border border-gray-300 text-gray-700 hover:bg-white'
                      : 'border border-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  disabled={!platform.ready}
                >
                  {platform.ready ? 'Connect' : 'Coming soon'}
                </button>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
