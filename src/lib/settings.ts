import { prisma } from './prisma'

/**
 * Shared settings resolver + Claude model tiering (PRD §10).
 *
 * Everything the pipeline used to hardcode (which Claude model, which TTS
 * provider/voice, whether auto agents auto-publish) is resolved here from the
 * Setting table, with optional per-factory overrides. Resolution order is
 * always: factory.config override → operator Setting → safe default.
 */

// ── Settings table access ──────────────────────────────────────────────────

/** Fetch every setting (or a subset) as a plain map. */
export async function getSettings(keys?: string[]): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany(
    keys ? { where: { key: { in: keys } } } : undefined
  )
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** One setting with a fallback. Empty strings are treated as "unset". */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value?.trim() ? row.value : fallback
}

// ── Claude model tiering ────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'sonnet5' | 'opus'

/** Tier → current model id (kept in sync with docs/Deferred-Features.md). */
export const MODEL_BY_TIER: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  sonnet5: 'claude-sonnet-5',
  opus: 'claude-opus-4-8',
}

/** Per-1M-token USD pricing (input, output) — PRD §10. Sonnet 5 uses the
 *  standard $3/$15 rate rather than the 2026-08-31 intro rate, to avoid
 *  under-billing CostLedger. */
const PRICE_BY_TIER: Record<ModelTier, { input: number; output: number }> = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
  sonnet5: { input: 3, output: 15 },
  opus: { input: 5, output: 25 },
}

export interface ResolvedModel {
  tier: ModelTier
  model: string
  /** USD per input/output token (already divided by 1M). */
  inputCostPerToken: number
  outputCostPerToken: number
}

function tierFromValue(v: string | undefined): ModelTier | null {
  if (!v) return null
  const t = v.toLowerCase()
  if (t === 'haiku' || t === 'sonnet' || t === 'sonnet5' || t === 'opus') return t
  // Allow passing a full model id too (e.g. factory configs that store the id).
  for (const [tier, id] of Object.entries(MODEL_BY_TIER)) {
    if (id === v) return tier as ModelTier
  }
  return null
}

/**
 * Resolve which Claude model a stage should use. `factoryOverride` comes from
 * factory.config (e.g. config.scriptModel or config.modelTier); falls back to
 * the operator's default_model_tier setting, then to sonnet.
 */
export async function resolveModel(factoryOverride?: string): Promise<ResolvedModel> {
  const tier =
    tierFromValue(factoryOverride) ||
    tierFromValue(await getSetting('default_model_tier')) ||
    'sonnet'
  const price = PRICE_BY_TIER[tier]
  return {
    tier,
    model: MODEL_BY_TIER[tier],
    inputCostPerToken: price.input / 1_000_000,
    outputCostPerToken: price.output / 1_000_000,
  }
}

/**
 * Cost of a Claude call from its usage block, honouring cached-read discount
 * (cache reads bill at ~0.1× input). Returns total USD + billable unit count.
 */
export function claudeCallCost(
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  },
  m: ResolvedModel
): { total: number; units: number } {
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) * 0.1
  const total =
    inputTokens * m.inputCostPerToken + (usage.output_tokens ?? 0) * m.outputCostPerToken
  const units = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
  return { total, units }
}

// ── Auto-publish toggle ─────────────────────────────────────────────────────

/**
 * Whether auto agents (autonomy=auto) should publish straight to YouTube once a
 * video is approved. Off by default so connecting YouTube doesn't surprise the
 * operator with live uploads — they opt in in Settings.
 */
export async function autoPublishEnabled(): Promise<boolean> {
  const v = (await getSetting('auto_publish_enabled', 'false')).toLowerCase()
  return v === 'true' || v === '1' || v === 'on'
}
