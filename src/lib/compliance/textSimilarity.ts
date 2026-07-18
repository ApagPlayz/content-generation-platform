// Shared text-similarity primitives for the anti-repetition checks. Extracted
// so there is exactly ONE implementation of word-shingles + Jaccard overlap,
// used by both the True Crime/History variation gate (variation.ts) and the
// generic sports/reddit variation gate (genericVariation.ts). Keeping a single
// copy means the two gates can never quietly drift apart.

import { tokenize } from './sources'

/** N-gram word shingles for narration-level similarity (default 4-grams). */
export function shingles(text: string, n = 4): Set<string> {
  const words = tokenize(text)
  const out = new Set<string>()
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '))
  return out
}

/** Jaccard overlap of two shingle sets (0 = nothing in common, 1 = identical). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
