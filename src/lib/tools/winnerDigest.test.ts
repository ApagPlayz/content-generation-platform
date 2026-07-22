// Tests for buildDigestText — the pure core of the analytics "learn from
// winners" loop (Issue #43). This is the summary that gets written into
// Agent.memory and then fed back into the script stage to bias the next run
// toward proven topics/hooks. If it silently produced an empty or misleading
// digest, the whole feedback loop would go quiet and the owner would never know
// — so these cases lock the ranking, the best-hook math, and the "nothing to
// learn yet" guard.

import { describe, expect, it } from 'vitest'
import { buildDigestText, type VideoPerf } from './winnerDigest'

const asOf = new Date('2026-07-16T00:00:00Z')

function perf(over: Partial<VideoPerf>): VideoPerf {
  return { title: 'Untitled', hookStyle: null, views: 0, ...over }
}

describe('buildDigestText', () => {
  it('returns null when there is nothing to learn from yet', () => {
    expect(buildDigestText([], asOf)).toBeNull()
    // Videos exist but none has any views — still nothing proven.
    expect(buildDigestText([perf({ views: 0 }), perf({ views: 0 })], asOf)).toBeNull()
  })

  it('ranks the top performers by views, highest first', () => {
    const text = buildDigestText(
      [
        perf({ title: 'Middle', views: 5000 }),
        perf({ title: 'Winner', views: 12400 }),
        perf({ title: 'Low', views: 210 }),
      ],
      asOf
    )!
    expect(text).toContain('as of 2026-07-16')
    const lines = text.split('\n')
    // Order: header, "Top performers:", then #1 Winner, #2 Middle, #3 Low.
    expect(lines[2]).toBe('1. "Winner" — 12,400 views')
    expect(lines[3]).toBe('2. "Middle" — 5,000 views')
    expect(lines[4]).toBe('3. "Low" — 210 views')
    // Thousands are formatted for the non-technical owner.
    expect(text).toContain('12,400 views')
  })

  it('caps the top list at three even with more winners', () => {
    const text = buildDigestText(
      [1, 2, 3, 4, 5].map((n) => perf({ title: `V${n}`, views: n * 1000 })),
      asOf
    )!
    expect(text).toContain('1. "V5" — 5,000 views')
    expect(text).toContain('3. "V3" — 3,000 views')
    expect(text).not.toContain('"V2"') // only surfaced as the weakest line
  })

  it('names the hook style with the best average views', () => {
    const text = buildDigestText(
      [
        perf({ title: 'A', hookStyle: 'bold number', views: 10000 }),
        perf({ title: 'B', hookStyle: 'bold number', views: 8000 }),
        perf({ title: 'C', hookStyle: 'quote', views: 500 }),
      ],
      asOf
    )!
    expect(text).toContain('Best hook style: bold number.')
    expect(text).toContain('· bold number hook')
  })

  it('calls out the single weakest video so duds are visible', () => {
    const text = buildDigestText(
      [perf({ title: 'Winner', views: 9000 }), perf({ title: 'Dud', views: 120 })],
      asOf
    )!
    expect(text).toContain('Weakest so far: "Dud" — 120 views.')
    expect(text).toContain('make more like the winners')
  })

  it('omits the weakest line when there is only one winner', () => {
    const text = buildDigestText([perf({ title: 'Solo', views: 9000 })], asOf)!
    expect(text).not.toContain('Weakest so far')
  })
})
