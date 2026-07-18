// Unit tests for the shared text-similarity primitives that both the True Crime
// variation gate (variation.ts) and the generic gate (genericVariation.ts) rely
// on. Extracting them into one place is only safe if their behaviour is pinned.

import { describe, expect, it } from 'vitest'
import { shingles, jaccard } from './textSimilarity'

describe('shingles', () => {
  it('is empty when there are fewer words than the n-gram size', () => {
    expect(shingles('two words').size).toBe(0)
  })

  it('produces 4-gram shingles from meaningful words', () => {
    // tokenize() drops stopwords + short words, so use distinctive terms.
    const s = shingles('brilliant overtime buzzer winner thunderous celebration')
    expect(s.size).toBeGreaterThan(0)
  })
})

describe('jaccard', () => {
  it('is 0 for two empty sets', () => {
    expect(jaccard(new Set(), new Set())).toBe(0)
  })

  it('is 1 for identical sets', () => {
    const a = new Set(['x y z w', 'y z w q'])
    expect(jaccard(a, new Set(a))).toBe(1)
  })

  it('is 0 when one side is empty', () => {
    expect(jaccard(new Set(['a b c d']), new Set())).toBe(0)
  })

  it('computes overlap over union', () => {
    const a = new Set(['a', 'b', 'c'])
    const b = new Set(['b', 'c', 'd'])
    // intersection 2 (b,c) / union 4 (a,b,c,d) = 0.5
    expect(jaccard(a, b)).toBe(0.5)
  })

  it('gives identical narration a similarity of 1', () => {
    const text = 'incredible last second three pointer wins the championship game outright'
    expect(jaccard(shingles(text), shingles(text))).toBe(1)
  })
})
