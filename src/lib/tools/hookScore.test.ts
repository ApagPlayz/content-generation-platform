import { describe, expect, it } from 'vitest'
import { scoreHook, pickBestHook } from './hookScore'

// The hook gate is the difference between a video that gets watched and one that
// dies in the first second. These tests pin the scorer's *ordering and bounds*
// (not magic totals, so weight tuning stays free) and prove it degrades safely.
describe('scoreHook', () => {
  it('scores a specific, concrete hook above a vague one', () => {
    expect(scoreHook('37 points in a single quarter').score).toBeGreaterThan(
      scoreHook('a pretty good game').score
    )
  })

  it('rewards a curiosity-gap question and labels the style', () => {
    const s = scoreHook('Why did nobody guard him?')
    expect(s.style).toBe('curiosity gap')
    expect(s.reasons.join(' ')).toMatch(/question|curiosity/i)
  })

  it('labels a number-led hook as a bold number', () => {
    expect(scoreHook('50 points before halftime').style).toBe('bold number')
  })

  it('penalises a line too long for the on-screen overlay', () => {
    const short = 'The final shot broke the game'
    const long =
      'The final shot of this incredibly long and rambling sentence broke the entire game for everyone watching'
    expect(scoreHook(short).score).toBeGreaterThan(scoreHook(long).score)
  })

  it('treats one emoji as a small plus but many as spam', () => {
    expect(scoreHook('Unreal buzzer beater 🔥').score).toBeGreaterThan(
      scoreHook('Unreal buzzer beater 🔥🔥🔥🔥').score
    )
  })

  it('always returns a score within 0-100', () => {
    for (const h of [
      '',
      'a',
      '50 record insane secret impossible unbelievable shocking 🔥',
      'Why? '.repeat(30),
      'A normal enough hook line here',
    ]) {
      const s = scoreHook(h)
      expect(s.score).toBeGreaterThanOrEqual(0)
      expect(s.score).toBeLessThanOrEqual(100)
    }
  })

  it('is deterministic', () => {
    expect(scoreHook('The comeback nobody expected')).toEqual(
      scoreHook('The comeback nobody expected')
    )
  })

  it('handles an empty candidate without throwing', () => {
    expect(scoreHook('').score).toBe(0)
    expect(scoreHook('   ').score).toBe(0)
  })
})

describe('pickBestHook', () => {
  it('picks the strongest candidate', () => {
    const { hook } = pickBestHook([
      'a good game',
      '42 points, 0 misses — nobody saw it coming',
      'watch this',
    ])
    expect(hook).toBe('42 points, 0 misses — nobody saw it coming')
  })

  it('returns the first candidate on a tie (graceful fallback)', () => {
    const { hook } = pickBestHook(['Same energy here', 'Same energy here'])
    expect(hook).toBe('Same energy here')
  })

  it('ignores blank candidates', () => {
    const { hook } = pickBestHook(['', '   ', 'The only real hook'])
    expect(hook).toBe('The only real hook')
  })

  it('returns an empty hook at score 0 when nothing is usable', () => {
    const r = pickBestHook([])
    expect(r.hook).toBe('')
    expect(r.score.score).toBe(0)
  })

  it('works with a single legacy hook', () => {
    const r = pickBestHook(['One line only'])
    expect(r.hook).toBe('One line only')
    expect(r.score.score).toBeGreaterThan(0)
  })
})
