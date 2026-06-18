import { prisma } from '../prisma'
import { resolveModel, claudeCallCost } from '../settings'
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
          text: `${playbook}\n\nYou write metadata for short-form vertical sports highlight videos. Respond with ONLY a JSON object: {"title": string (max 80 chars, punchy, no clickbait lies), "hook": string (first line of on-screen text, max 60 chars), "description": string (1-2 sentences), "hashtags": string[] (5-8, no # prefix)}`,
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
  return {
    title: String(parsed.title ?? '').slice(0, 100),
    hook: String(parsed.hook ?? ''),
    description: String(parsed.description ?? ''),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
  }
}

function templateScript(source: SourceResult): ScriptResult {
  const base = {
    trending_game: {
      title: source.triggerReason.split(' (')[0],
      hook: 'You have to see this finish 🔥',
      hashtags: ['nba', 'basketball', 'highlights', 'sports', 'gamewinner'],
    },
    player_career: {
      title: source.triggerReason.replace('Career highlights feature for ', '') + ' — best plays',
      hook: 'Career. Highlights. 🐐',
      hashtags: ['nba', 'basketball', 'goat', 'highlights', 'careerhighlights'],
    },
    trending_audio: {
      title: 'NBA highlights you need to see',
      hook: 'Wait for the drop 👀',
      hashtags: ['nba', 'basketball', 'edit', 'highlights', 'fyp'],
    },
  }[source.strategy]
  return { ...base, description: source.triggerReason }
}
