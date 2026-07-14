import { prisma } from '../prisma'
import { resolveModel, claudeCallCost } from '../settings'
import { pickBestHook } from './hookScore'
import type { ScriptResult, SourceResult } from './types'

/**
 * Generate title/hook/description/hashtags with Claude. The playbook is the
 * stable cached prefix; only the per-video trigger goes after the breakpoint.
 * The Claude model follows the factory's tier (config.scriptModel/modelTier)
 * or the operator's default tier — see src/lib/settings.ts. Falls back to a
 * template if ANTHROPIC_API_KEY is not set.
 */
export async function runScript(
  videoId: string,
  playbook: string,
  source: SourceResult,
  modelOverride?: string
): Promise<ScriptResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return templateScript(source)

  const m = await resolveModel(modelOverride)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: m.model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: `${playbook}\n\nYou write metadata AND original on-screen analysis for short-form vertical sports highlight videos. The analysis is burned onto the clip as your OWN commentary — it must be substantive and in your words, never transcribed from the source broadcast. The first line on screen (the HOOK) decides whether anyone keeps watching — brainstorm several distinct angles (a bold number, a curiosity gap, a pattern-interrupt) and return 3-5 candidates so the strongest can be chosen. Respond with ONLY a JSON object: {"title": string (max 80 chars, punchy, no clickbait lies), "hooks": string[] (3-5 candidate first lines of on-screen text, each max 60 chars, distinct angles), "description": string (1-2 sentences), "hashtags": string[] (5-8, no # prefix), "analysis": string[] (2-4 short original commentary/analysis lines about the play, each max 70 chars), "telestration": [{"label": string (max 18 chars), "atSec": number (seconds into the clip, 0-20)}] (0-3 optional on-screen callouts)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Strategy: ${source.strategy}\nTrigger: ${source.triggerReason}\nDetails: ${JSON.stringify(source.sourceData)}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()
  const { total, units } = claudeCallCost(data.usage ?? {}, m)
  await prisma.costLedger.create({
    data: {
      videoId,
      service: m.model,
      units,
      unitCost: m.inputCostPerToken,
      total,
    },
  })

  const text: string = data.content?.[0]?.text ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Claude returned non-JSON script output: ${text.slice(0, 200)}`)
  const parsed = JSON.parse(jsonMatch[0])
  // Accept the new candidate array; tolerate an older single-"hook" response so
  // an in-flight or cached model reply never crashes the script stage.
  const candidates: string[] = Array.isArray(parsed.hooks)
    ? parsed.hooks.map(String)
    : parsed.hook
      ? [String(parsed.hook)]
      : []
  const best = pickBestHook(candidates)
  return {
    title: String(parsed.title ?? '').slice(0, 100),
    hook: best.hook,
    hookScore: best.score.score,
    hookStyle: best.score.style,
    description: String(parsed.description ?? ''),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
    analysis: Array.isArray(parsed.analysis)
      ? parsed.analysis.map(String).slice(0, 4)
      : [],
    telestration: Array.isArray(parsed.telestration)
      ? parsed.telestration
          .map((t: { label?: unknown; atSec?: unknown }) => ({
            label: String(t?.label ?? ''),
            atSec: t?.atSec != null ? Number(t.atSec) : undefined,
          }))
          .filter((t: { label: string }) => t.label)
          .slice(0, 3)
      : [],
  }
}

function templateScript(source: SourceResult): ScriptResult {
  const base = {
    trending_game: {
      title: source.triggerReason.split(' (')[0],
      // Several canned angles so the gate below picks a real winner offline too.
      hooks: [
        'You have to see this finish 🔥',
        'Nobody saw this ending coming',
        'The final 10 seconds broke the game',
      ],
      hashtags: ['nba', 'basketball', 'highlights', 'sports', 'gamewinner'],
      analysis: [
        'Watch the spacing open up before the shot',
        'One read, one swing — the defense is a step late',
        'This is the possession that swung the game',
      ],
    },
    player_career: {
      title: source.triggerReason.replace('Career highlights feature for ', '') + ' — best plays',
      hooks: [
        'Career. Highlights. 🐐',
        'How is this even humanly possible?',
        'The 3 plays that made him a legend',
      ],
      hashtags: ['nba', 'basketball', 'goat', 'highlights', 'careerhighlights'],
      analysis: [
        'Footwork here is textbook — nothing wasted',
        'Reads the help defender before he even commits',
        'A signature move you have seen a hundred times',
      ],
    },
    trending_audio: {
      title: 'NBA highlights you need to see',
      hooks: [
        'Wait for the drop 👀',
        'This edit is absolutely insane',
        'The beat hits right when it matters',
      ],
      hashtags: ['nba', 'basketball', 'edit', 'highlights', 'fyp'],
      analysis: [
        'Timing the cut to the beat',
        'Peak energy lands right on the drop',
      ],
    },
  }[source.strategy]
  const { hooks, ...rest } = base
  const best = pickBestHook(hooks)
  return {
    ...rest,
    hook: best.hook,
    hookScore: best.score.score,
    hookStyle: best.score.style,
    description: source.triggerReason,
    telestration: [],
  }
}
