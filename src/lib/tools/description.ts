// Per-factory call-to-action (CTA) blocks — issue #27. Every published video
// already has a generated `description`, but we never attached the "money part":
// a follow line + optional link. Affiliate/CTA income has no subscriber
// threshold, so it earns from view #1 — long before ad revenue turns on.
//
// This module is deliberately PURE (no prisma / no googleapis): it owns the
// built-in default CTA table and the description/caption builders, so both the
// publisher (server-only, pulls in googleapis) AND the Review Inbox preview
// (a server component) can compose the exact same text without dragging the
// upload SDK into places it doesn't belong. All DB access (reading a factory's
// override) stays in the caller.

export interface CtaConfig {
  /** The follow / call-to-action line. A blank string disables the CTA block. */
  text: string
  /** Optional owner link appended under the CTA (no built-in default sets one). */
  url?: string
}

// Safe, generic "follow for more" copy per factory type. No fake affiliate URLs
// — the owner adds a real link later via the factory's postingDefaults override.
export const CTA_BY_FACTORY: Record<string, CtaConfig> = {
  F1: { text: '👉 Follow for a wild new Reddit story every day.' },
  F9: { text: '🏆 Follow for daily sports highlights and the best moments in the game.' },
  F10: {
    text: '🔎 Follow for a new case every day. Based on publicly reported information.',
  },
  F11: { text: '📚 Follow for daily history & business mini-docs.' },
}

// Fallback for any factory type without a specific entry above.
export const DEFAULT_CTA: CtaConfig = { text: '👉 Follow for more videos like this.' }

// YouTube caps descriptions at 5000 chars; keep headroom. TikTok captions are
// far shorter in practice — ~2200 — so cap those separately.
const YT_MAX = 4900
const TIKTOK_MAX = 2100

/**
 * Resolve the CTA for a factory: the owner's per-factory override wins, else the
 * built-in default for that type, else the generic DEFAULT_CTA. Pure — the
 * override is passed in already-parsed, so this is trivially unit-tested.
 */
export function resolveCta(
  factoryType: string,
  override?: Partial<CtaConfig> | null
): CtaConfig {
  const base = CTA_BY_FACTORY[factoryType] ?? DEFAULT_CTA
  const merged: CtaConfig = { ...base, ...(override ?? {}) }
  // A whitespace-only text means "no CTA" — normalise so builders can drop it.
  if (!merged.text || !merged.text.trim()) merged.text = ''
  return merged
}

/**
 * Safely pull a `{ text, url }` CTA override out of a factory's postingDefaults
 * JSON string. Never throws on malformed JSON — a bad column must not break a
 * publish; it just falls back to the built-in default.
 */
export function ctaOverrideFromPostingDefaults(
  postingDefaults: string | null | undefined
): Partial<CtaConfig> | null {
  if (!postingDefaults) return null
  try {
    const parsed = JSON.parse(postingDefaults) as { cta?: Partial<CtaConfig> }
    return parsed?.cta ?? null
  } catch {
    return null
  }
}

/** Render a CTA as a text block (text plus optional link), or '' when unset. */
export function ctaBlock(cta: CtaConfig): string {
  if (!cta.text || !cta.text.trim()) return ''
  const url = cta.url && cta.url.trim() ? cta.url.trim() : ''
  return [cta.text.trim(), url].filter(Boolean).join('\n')
}

/**
 * Build a YouTube Short description from its parts. Order: body → hashtags → CTA
 * → #Shorts, blank-line separated, empties dropped. The fixed tail (hashtags,
 * CTA, #Shorts) is ALWAYS preserved; if the whole thing would exceed the cap,
 * the body is truncated so the CTA and #Shorts are never cut off. Pure.
 */
export function composeDescription(input: {
  body: string | null | undefined
  hashtags: string[]
  cta: CtaConfig
  maxLen?: number
}): string {
  const maxLen = input.maxLen ?? YT_MAX
  const tail = [
    input.hashtags.map((h) => `#${h}`).join(' '),
    ctaBlock(input.cta),
    '#Shorts',
  ]
    .filter(Boolean)
    .join('\n\n')

  const body = (input.body ?? '').trim()
  if (!body) return tail.slice(0, maxLen)

  // Reserve room for the tail (+ the blank-line separator) so the CTA survives.
  const room = maxLen - tail.length - 2
  const bodyPart = room > 0 ? body.slice(0, room) : ''
  return [bodyPart, tail].filter(Boolean).join('\n\n').slice(0, maxLen)
}

/**
 * Build a TikTok caption: title + hashtags + CTA, space-joined (TikTok has no
 * multi-line description field like YouTube). Same tail-preserving cap. Pure.
 */
export function composeCaption(input: {
  title: string | null | undefined
  hashtags: string[]
  cta: CtaConfig
  maxLen?: number
}): string {
  const maxLen = input.maxLen ?? TIKTOK_MAX
  const tail = [input.hashtags.map((h) => `#${h}`).join(' '), ctaBlock(input.cta)]
    .filter(Boolean)
    .join(' ')

  const title = (input.title ?? '').trim()
  if (!title) return tail.slice(0, maxLen)

  const room = maxLen - tail.length - 1
  const titlePart = room > 0 ? title.slice(0, room) : ''
  return [titlePart, tail].filter(Boolean).join(' ').slice(0, maxLen)
}
