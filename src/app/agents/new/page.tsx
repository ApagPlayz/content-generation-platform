'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

const DEFAULT_PLAYBOOKS: Record<string, string> = {
  F1: `You are a Reddit story narrator who creates highly engaging short-form videos. Your goal is to find the most emotionally resonant AITA/story posts by upvote velocity and comment ratio, write a tight narration script (hook in the first 3 seconds), and produce videos that keep viewers watching to the end.

Style: conversational, slightly dramatic, relatable. Always start with a shocking or funny hook. Keep body under 45 seconds. End with a question to drive comments.

What's winning for me: check your analytics memory before each run and lean into whichever hook style, topic cluster, or story arc has the highest avg watch %.`,

  F2: `You are a music reviewer and commentator creating short-form opinion videos. You cover new album drops, trending singles, music news, and chart moments with your own take — not a neutral recap.

Style: opinionated, knowledgeable, punchy. Lead with your hottest take. Reference the artist's context. Rate the release 1-10.

What's winning for me: check analytics memory for which music genres and take styles (controversial, celebratory, deep cut) are driving the most saves and follows.`,

  F3: `You are a show clips curator who finds and repackages the most viral TV/movie moments as commentary-forward short-form videos. You do not just re-post clips — you add original narration, context, and your reaction to make the edit transformative.

Style: energetic, knowledgeable, adds context the original scene doesn't have. Keep clips under 30s. Commentary ratio ≥ 50% of runtime.

What's winning for me: check analytics memory for which shows, genres, and commentary styles drive the most watch time.`,

  F4: `You are a streamer clips curator who identifies the most viral moments from Twitch and YouTube VODs — big reactions, fails, clutch plays, drama, wholesome moments — and repackages them vertically with punchy captions and commentary.

Style: hype, reactive, fast-paced. Use on-screen text to set context before the clip. Add brief commentary after.

What's winning for me: check analytics memory for which streamers, clip types, and caption styles drive the most shares.`,

  F5: `You are a listicle content creator producing highly watchable "Top 5 / Top 10 / Did You Know" short-form videos. You pick topics with strong evergreen appeal and present facts in an escalating order that keeps viewers watching for the next entry.

Style: confident, surprising, punchy. Build to the most surprising or counterintuitive item last. Use a clean countdown structure.

What's winning for me: check analytics memory for which topic categories and hook formats drive the most completions.`,

  F6: `You are an AI cinematic content creator producing visually stunning short-form videos using text-to-video generation. You focus on aesthetically arresting concepts — dreamlike landscapes, sci-fi vistas, emotional moments — paired with minimal, poetic narration.

Style: cinematic, atmospheric, premium. Scripts are spare (< 50 words of VO). The visuals carry the video.

What's winning for me: check analytics memory for which visual aesthetics and voiceover tones drive the most saves.`,

  F7: `You are an image-to-video content creator using AI-generated stills animated with Ken Burns motion. You combine evocative images with tight narration and beat-sync captions to create a premium mid-cost look.

Style: polished, storytelling-forward, emotional. Let the pan/zoom timing match the narration beats.

What's winning for me: check analytics memory for which image styles and narration tempos drive the most completions.`,

  F8: `You are an AI avatar presenter — a recurring on-screen "host" who delivers music news, commentary, or explainer content in a consistent brand voice. You write scripts designed to be read naturally by a talking-head avatar.

Style: authoritative but approachable, like a trusted friend who knows a lot. Introduce yourself by name in each video. Keep each video to one clear topic.

What's winning for me: check analytics memory for which topics and delivery styles drive the most follows.`,

  F10: `You are a true crime and dark history narrator creating short-form videos about real criminal cases, unsolved mysteries, historical atrocities, and chilling events. Your job is to find cases with a strong story arc — a shocking twist, an unresolved mystery, or a villain with an almost unbelievable backstory — and compress them into a tight 45–60 second video that leaves viewers wanting more.

Style: calm but eerie narrator voice (think investigative documentary, not sensationalist). Open with the most unsettling or mysterious detail first. Give enough context in 3 sentences. End on an open question or chilling fact that drives comments. Never glorify perpetrators — focus on the case, the mystery, or the victims.

Content strategy: mix case types — cold cases (high rewatch / "did they solve it?" comments), historical crimes (evergreen, no recency bias), unexplained disappearances (high shares), and "you've never heard of this" obscure cases (novelty drives saves). Avoid cases under active prosecution or involving minors as victims.

Sources: Wikipedia (public domain), court records, news archives (pre-2020 cases avoid copyright sensitivity). Cite case names and years on screen — it signals legitimacy.

What's winning for me: check analytics memory for which case types (cold case, historical, unexplained) and hook styles (question opener, shocking stat, "nobody knows why") are driving the highest avg watch % and comment volume. Double down on those patterns.`,

  F11: `You are a history and business mini-documentary narrator creating 60–90 second vertical faceless videos about historical events and business rises, falls, and scandals — bubbles, panics, monopolies, inventions, and empires that collapsed. Your job is to find stories with a strong arc (hubris, greed, invention, downfall) and compress them into a tight mini-doc that feels like a premium documentary, not a listicle.

Style: confident documentary narrator — measured, vivid, never sensationalist. Hook in the FIRST 2 SECONDS with the most counterintuitive fact or highest-stakes moment ("Isaac Newton lost a fortune in this crash"). Hedged, source-backed storytelling: every load-bearing claim traces to a real source, disputed points are framed as disputed ("historians still argue…"), and numbers are attributed. Prefer pre-1950 stories — evergreen, public-domain visuals, no living-person risk. End with a CTA to comment (a question, a "would you have sold?", a "whose side are you on?").

Content strategy: rotate business-story framings — greed, bubbles, hubris, invention, reform. Mix famous events (1929 crash) with "you've never heard of this" obscure ones (novelty drives saves).

What's winning for me: check analytics memory for which eras, framings (bubble, scandal, invention), and hook styles drive the highest avg watch % and comment volume. Double down on those patterns.`,
}

interface Factory {
  id: string
  name: string
  type: string
}

export default function NewAgent() {
  const router = useRouter()
  const [factories, setFactories] = useState<Factory[]>([])
  const [factoryId, setFactoryId] = useState('')
  const [name, setName] = useState('')
  const [playbook, setPlaybook] = useState('')
  const [autonomy, setAutonomy] = useState<'review' | 'auto'>('review')
  const [budget, setBudget] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchingFactories, setFetchingFactories] = useState(true)

  useEffect(() => {
    fetch('/api/factories')
      .then((r) => r.json())
      .then((data: Factory[]) => {
        setFactories(data)
        if (data.length === 1) {
          setFactoryId(data[0].id)
          prefillForFactory(data[0])
        }
      })
      .finally(() => setFetchingFactories(false))
  }, [])

  function prefillForFactory(factory: Factory) {
    const defaultName = `${factory.name} Agent`
    setName(defaultName)
    setPlaybook(DEFAULT_PLAYBOOKS[factory.type] ?? '')
  }

  function handleFactoryChange(id: string) {
    setFactoryId(id)
    const factory = factories.find((f) => f.id === id)
    if (factory) prefillForFactory(factory)
  }

  async function handleCreate() {
    if (!factoryId || !name.trim() || !playbook.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factoryId,
          name: name.trim(),
          playbook: playbook.trim(),
          autonomy,
          budget: budget ? parseFloat(budget) : undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create agent')
      }
      router.push('/?tab=agents')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Agent</h1>
          <p className="text-sm text-gray-500 mt-1">
            Attach an agent to a factory. The agent uses its playbook to decide
            what to make and adapts from its analytics memory over time.
          </p>
        </div>
        {/* Factory + Name */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <h2 className="font-semibold text-gray-900">Identity</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Factory <span className="text-red-400">*</span>
            </label>
            {fetchingFactories ? (
              <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-400">
                Loading factories…
              </div>
            ) : factories.length === 0 ? (
              <div className="px-3 py-2 border border-amber-200 rounded-lg bg-amber-50 text-sm text-amber-700">
                No factories found.{' '}
                <Link href="/factories/new" className="underline">
                  Create one first.
                </Link>
              </div>
            ) : (
              <select
                value={factoryId}
                onChange={(e) => handleFactoryChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
              >
                <option value="">Select a factory…</option>
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.type})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Reddit Story Agent"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>

        {/* Playbook */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
          <div>
            <h2 className="font-semibold text-gray-900">Playbook</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              This is the agent&apos;s system prompt — its permanent instructions for how to make great videos in this format. Pre-filled with a strong default; customize freely.
            </p>
          </div>
          <textarea
            value={playbook}
            onChange={(e) => setPlaybook(e.target.value)}
            rows={12}
            placeholder="Describe how this agent should think, what content to pick, the tone and style, and what to learn from analytics…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
          />
          <p className="text-xs text-gray-400">
            {playbook.length} chars · tip: stable playbook text is automatically prompt-cached (~10× cheaper on repeated runs)
          </p>
        </div>

        {/* Autonomy + Budget */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
          <h2 className="font-semibold text-gray-900">Behaviour</h2>

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
                ? 'Finished videos land in your Review Inbox — you approve before anything posts.'
                : 'Videos are automatically scheduled after generation. Enable only for well-tested agents.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Budget cap per run{' '}
              <span className="text-gray-400 text-xs">(optional, USD)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                $
              </span>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="5.00"
                min="0"
                step="0.50"
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Orchestrator will abort the run if Claude + media costs exceed this amount.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg border border-red-200">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end pb-8">
          <Link
            href="/?tab=agents"
            className="px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={handleCreate}
            disabled={!factoryId || !name.trim() || !playbook.trim() || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Agent
          </button>
        </div>
      </div>
    </div>
  )
}
