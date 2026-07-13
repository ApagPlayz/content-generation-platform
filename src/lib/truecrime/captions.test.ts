// Unit tests for the pure caption helpers (src/lib/truecrime/captions.ts).
// Video-quality round 3 fixed caption chunks that opened on a bare punctuation
// token (a page starting ",", "." or "—"): isPunctuationOnly classifies such
// tokens, mergeLeadingPunctuation folds them into the previous word for the
// heuristic path, and mergePunctuationStamps does the same for Kokoro word
// stamps (extending the previous stamp's window so karaoke timing stays real).
// heuristicCues/kokoroCues are asserted end-to-end: no cue text may ever begin
// with a punctuation-only token.

import { describe, expect, it } from 'vitest'
import {
  heuristicCues,
  isPunctuationOnly,
  kokoroCues,
  mergeLeadingPunctuation,
  mergePunctuationStamps,
} from './captions'
import type { WordStamp } from './types'

/** True when a cue's first whitespace-token is punctuation-only — the exact
 *  defect this round fixed. */
function startsWithBarePunctuation(text: string): boolean {
  const first = text.split(/\s+/).filter(Boolean)[0]
  return first != null && isPunctuationOnly(first)
}

describe('isPunctuationOnly', () => {
  it('classifies bare punctuation tokens', () => {
    for (const t of [',', '.', '—', '...', '?!', '"', '…']) {
      expect(isPunctuationOnly(t)).toBe(true)
    }
  })

  it('does not classify words, numbers, or punctuation attached to a word', () => {
    for (const t of ['night', 'night,', '1907', '"quote"', "don't"]) {
      expect(isPunctuationOnly(t)).toBe(false)
    }
  })

  it('is false for the empty string (nothing to merge or strip)', () => {
    expect(isPunctuationOnly('')).toBe(false)
  })
})

describe('mergeLeadingPunctuation', () => {
  it('merges a punctuation-only token into the previous word, without a space', () => {
    expect(mergeLeadingPunctuation(['dark', ',', 'cold'])).toEqual(['dark,', 'cold'])
  })

  it('merges consecutive punctuation tokens into the same carrier word', () => {
    expect(mergeLeadingPunctuation(['end', '.', '.', '.'])).toEqual(['end...'])
  })

  it('strips punctuation with no previous word to attach to', () => {
    expect(mergeLeadingPunctuation(['—', 'it', 'began'])).toEqual(['it', 'began'])
  })

  it('passes clean word lists through unchanged', () => {
    expect(mergeLeadingPunctuation(['three', 'clean', 'words'])).toEqual(['three', 'clean', 'words'])
  })
})

describe('mergePunctuationStamps', () => {
  const stamp = (word: string, startSec: number, endSec: number): WordStamp => ({ word, startSec, endSec })

  it('folds a punctuation stamp into the previous word and extends its window', () => {
    const merged = mergePunctuationStamps([stamp('night', 0, 0.4), stamp(',', 0.4, 0.5), stamp('alone', 0.5, 0.9)])
    expect(merged).toEqual([stamp('night,', 0, 0.5), stamp('alone', 0.5, 0.9)])
  })

  it('never shrinks the previous stamp when the punctuation window ends earlier', () => {
    const merged = mergePunctuationStamps([stamp('night', 0, 0.6), stamp(',', 0.4, 0.5)])
    expect(merged).toEqual([stamp('night,', 0, 0.6)])
  })

  it('drops a leading punctuation stamp with no carrier word', () => {
    const merged = mergePunctuationStamps([stamp('—', 0, 0.1), stamp('it', 0.1, 0.3)])
    expect(merged).toEqual([stamp('it', 0.1, 0.3)])
  })

  it('returns [] for all-punctuation input (caller falls back to heuristic cues)', () => {
    expect(mergePunctuationStamps([stamp('.', 0, 0.1), stamp(',', 0.1, 0.2)])).toEqual([])
  })

  it('does not mutate the input stamps', () => {
    const input = [stamp('night', 0, 0.4), stamp(',', 0.4, 0.5)]
    mergePunctuationStamps(input)
    expect(input[0]).toEqual(stamp('night', 0, 0.4))
  })
})

describe('heuristicCues', () => {
  it('never emits a cue that begins with a punctuation-only token', () => {
    // 3-word pages make "," the would-be first token of page 2 without the merge.
    const narration = 'The house stood empty , silent and dark . No one returned'
    const cues = heuristicCues(narration, 20)
    expect(cues.length).toBeGreaterThan(1)
    for (const cue of cues) expect(startsWithBarePunctuation(cue.text)).toBe(false)
  })

  it('keeps every non-punctuation word and spans the full duration', () => {
    const narration = 'It began , as these stories do , with a phone call'
    const cues = heuristicCues(narration, 12)
    const joined = cues.map((c) => c.text).join(' ')
    expect(joined.replace(/[^a-z\s]/gi, ' ').replace(/\s+/g, ' ').trim()).toBe(
      'It began as these stories do with a phone call'
    )
    expect(cues[0].startSec).toBe(0)
    expect(cues[cues.length - 1].endSec).toBeCloseTo(12, 1)
  })
})

describe('kokoroCues', () => {
  it('never opens a page on bare punctuation once stamps are merged', () => {
    // Six stamps → two 3-word pages; the punctuation stamp would open page 2.
    const words: WordStamp[] = [
      { word: 'He', startSec: 0, endSec: 0.2 },
      { word: 'never', startSec: 0.2, endSec: 0.5 },
      { word: 'returned', startSec: 0.5, endSec: 1.0 },
      { word: ',', startSec: 1.0, endSec: 1.1 },
      { word: 'they', startSec: 1.1, endSec: 1.3 },
      { word: 'said', startSec: 1.3, endSec: 1.6 },
    ]
    const cues = kokoroCues(mergePunctuationStamps(words))
    expect(cues.length).toBe(2)
    expect(cues[0].text).toBe('He never returned,')
    expect(cues[1].text).toBe('they said')
    for (const cue of cues) {
      expect(startsWithBarePunctuation(cue.text)).toBe(false)
      for (const token of cue.tokens ?? []) expect(isPunctuationOnly(token.text)).toBe(false)
    }
  })
})
