// Unit tests for the generic (sports/reddit) anti-repetition gate (issue #17).
// The DB read is a thin wrapper; the decision lives in the pure
// evaluateGenericVariation(), tested here without a database — matching the
// repo's colocated pure-helper test style (see recovery.test.ts).

import { describe, expect, it } from 'vitest'
import {
  evaluateGenericVariation,
  normalizeUrl,
  SIMILARITY_THRESHOLD,
  type PriorVideo,
} from './genericVariation'

const CANDIDATE = {
  title: 'Insane buzzer beater ends the playoff series in overtime',
  hook: 'This last-second shot broke the entire arena into chaos',
  sourceUrl: 'https://youtube.com/watch?v=AAA111',
}

describe('evaluateGenericVariation', () => {
  it('passes the first-ever video (no priors to compare against)', () => {
    const v = evaluateGenericVariation(CANDIDATE, [])
    expect(v.passed).toBe(true)
    expect(v.maxSimilarity).toBe(0)
    expect(v.reasons[0]).toMatch(/no prior videos/i)
  })

  it('passes when recent videos are genuinely different', () => {
    const priors: PriorVideo[] = [
      {
        title: 'Rookie quarterback throws a stunning 70-yard touchdown pass',
        scriptText: 'Nobody expected this debut to go quite like it did',
        sourceUrl: 'https://youtube.com/watch?v=BBB222',
      },
    ]
    const v = evaluateGenericVariation(CANDIDATE, priors)
    expect(v.passed).toBe(true)
    expect(v.visualSimilarity).toBe(0)
  })

  it('flags a near-identical title/hook (same template stamped out again)', () => {
    const priors: PriorVideo[] = [
      {
        // Same words as the candidate → title/hook overlap crosses the wire.
        title: CANDIDATE.title,
        scriptText: CANDIDATE.hook,
        sourceUrl: 'https://youtube.com/watch?v=DIFFERENT',
      },
    ]
    const v = evaluateGenericVariation(CANDIDATE, priors)
    expect(v.passed).toBe(false)
    expect(v.maxSimilarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD)
    expect(v.reasons.join(' ')).toMatch(/mass-produced/i)
  })

  it('flags reuse of the exact same source clip even with a fresh title', () => {
    const priors: PriorVideo[] = [
      {
        title: 'A totally different, unrelated highlight with new commentary',
        scriptText: 'Completely fresh wording that shares nothing with the candidate',
        // Same reel (same ?v= id), differing only by a trailing fragment.
        sourceUrl: 'https://youtube.com/watch?v=AAA111#t=10',
      },
    ]
    const v = evaluateGenericVariation(CANDIDATE, priors)
    expect(v.passed).toBe(false)
    expect(v.visualSimilarity).toBe(1)
    expect(v.reasons.join(' ')).toMatch(/same source clip/i)
  })

  it('does not flag an empty script against other empty scripts', () => {
    const empty = { title: '', hook: '', sourceUrl: 'https://youtube.com/watch?v=NEW' }
    const priors: PriorVideo[] = [{ title: '', scriptText: '', sourceUrl: null }]
    const v = evaluateGenericVariation(empty, priors)
    expect(v.passed).toBe(true)
  })
})

describe('normalizeUrl', () => {
  it('is empty for null/undefined/blank', () => {
    expect(normalizeUrl(null)).toBe('')
    expect(normalizeUrl(undefined)).toBe('')
    expect(normalizeUrl('   ')).toBe('')
  })

  it('keeps the ?v= identity + case, dropping only fragment/trailing slash', () => {
    expect(normalizeUrl('https://www.youtube.com/watch?v=AbC111&t=3s#top/')).toBe(
      'https://www.youtube.com/watch?v=AbC111&t=3s'
    )
    // Distinct video ids (and case variants) stay distinct.
    expect(normalizeUrl('https://youtube.com/watch?v=AAA')).not.toBe(
      normalizeUrl('https://youtube.com/watch?v=aaa')
    )
  })
})
