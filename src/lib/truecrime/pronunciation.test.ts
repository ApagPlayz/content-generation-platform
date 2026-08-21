import { describe, it, expect } from 'vitest'
import {
  acronymWords,
  decadeWords,
  loadPronunciationLexicon,
  preparePronunciation,
  remapWordStamps,
  yearWords,
} from './pronunciation'
import type { WordStamp } from './types'

/** Build the word stamps a provider would return for a spoken string. */
function stampsFor(spoken: string, step = 1): WordStamp[] {
  return spoken
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ word, startSec: i * step, endSec: (i + 1) * step }))
}

describe('acronymWords', () => {
  it('spells out real acronyms letter by letter', () => {
    expect(acronymWords('FBI')).toBe('F B I')
    expect(acronymWords('DNA')).toBe('D N A')
    expect(acronymWords('NASA')).toBe('N A S A')
  })

  it('leaves ordinary words that happen to be capitalised alone', () => {
    for (const w of ['THE', 'AND', 'OK', 'NEVER', 'I']) {
      expect(acronymWords(w)).toBeNull()
    }
  })

  it('ignores anything that is not 2-6 plain capitals', () => {
    expect(acronymWords('Fbi')).toBeNull()
    expect(acronymWords('F')).toBeNull()
    expect(acronymWords('ABCDEFG')).toBeNull()
    expect(acronymWords('CSI:')).toBeNull()
  })
})

describe('yearWords', () => {
  it('reads years the way a narrator would', () => {
    expect(yearWords(1995)).toBe('nineteen ninety-five')
    expect(yearWords(1905)).toBe('nineteen oh five')
    expect(yearWords(1900)).toBe('nineteen hundred')
    expect(yearWords(1066)).toBe('ten sixty-six')
    expect(yearWords(2000)).toBe('two thousand')
    expect(yearWords(2001)).toBe('two thousand one')
    expect(yearWords(2024)).toBe('twenty twenty-four')
  })

  it('leaves numbers that are not years alone', () => {
    expect(yearWords(999)).toBeNull()
    expect(yearWords(2100)).toBeNull()
    expect(yearWords(3500)).toBeNull()
  })
})

describe('decadeWords', () => {
  it('reads decades naturally', () => {
    expect(decadeWords(1980)).toBe('nineteen eighties')
    expect(decadeWords(2010)).toBe('twenty tens')
    expect(decadeWords(2020)).toBe('twenty twenties')
    expect(decadeWords(1900)).toBe('nineteen hundreds')
    expect(decadeWords(2000)).toBe('two thousands')
  })

  it('returns null for a non-decade', () => {
    expect(decadeWords(1985)).toBeNull()
    expect(decadeWords(880)).toBeNull()
  })
})

describe('loadPronunciationLexicon', () => {
  it('reads a flat map', () => {
    expect(loadPronunciationLexicon('{"Gaddafi":"guh-DAH-fee"}')).toEqual({
      gaddafi: 'guh-DAH-fee',
    })
  })

  it('reads the nested {respell:{…}} shape too', () => {
    expect(loadPronunciationLexicon('{"respell":{"Nguyen":"nwin"},"acronyms":["DA"]}')).toEqual({
      nguyen: 'nwin',
    })
  })

  it('never throws on bad or empty input — a typo cannot stop a video', () => {
    for (const bad of ['', '   ', 'not json', '[1,2,3]', 'null', '{"a":5}', undefined, null]) {
      expect(loadPronunciationLexicon(bad)).toEqual({})
    }
  })
})

describe('preparePronunciation', () => {
  it('rewrites acronyms, years and known names for the voice', () => {
    const { spokenText } = preparePronunciation(
      'The FBI reopened the Gaddafi file in 1995, and again in the 1980s.'
    )
    expect(spokenText).toContain('F B I')
    expect(spokenText).toContain('guh-DAH-fee')
    expect(spokenText).toContain('nineteen ninety-five,')
    expect(spokenText).toContain('nineteen eighties.')
  })

  it('keeps punctuation attached to the rewritten word', () => {
    expect(preparePronunciation('(FBI),').spokenText).toBe('(F B I),')
    expect(preparePronunciation('"1995."').spokenText).toBe('"nineteen ninety-five."')
  })

  it('records the original spelling in every span', () => {
    const { spans } = preparePronunciation('The FBI in 1995.')
    expect(spans.map((s) => s.original)).toEqual(['The', 'FBI', 'in', '1995.'])
    expect(spans.map((s) => s.spoken)).toEqual([
      'The',
      'F B I',
      'in',
      'nineteen ninety-five.',
    ])
  })

  it('reports unchanged when there is nothing to fix', () => {
    const r = preparePronunciation('She walked home in the rain and never looked back.')
    expect(r.unchanged).toBe(true)
    expect(r.spokenText).toBe('She walked home in the rain and never looked back.')
  })

  it('treats collapsed whitespace as unchanged', () => {
    expect(preparePronunciation('one   two\ntwo').unchanged).toBe(true)
  })

  it('lets the operator override a built-in entry and add new ones', () => {
    const { spokenText } = preparePronunciation('Gaddafi met Sokolov.', {
      gaddafi: 'kad-AH-fee',
      sokolov: 'suh-KOH-lov',
    })
    expect(spokenText).toBe('kad-AH-fee met suh-KOH-lov.')
  })

  it('does not spell out every word when the script is written in capitals', () => {
    const shouty = 'THIS CASE SHOCKED THE ENTIRE COUNTRY AND NOBODY EVER FOUND HIM'
    expect(preparePronunciation(shouty).spokenText).toBe(shouty)
  })

  it('handles empty narration without throwing', () => {
    expect(preparePronunciation('')).toEqual({ spokenText: '', spans: [], unchanged: true })
  })
})

describe('remapWordStamps', () => {
  it('restores the original spelling so captions never read "F B I"', () => {
    const { spokenText, spans } = preparePronunciation('The FBI closed it in 1995.')
    const remapped = remapWordStamps(stampsFor(spokenText), spans)
    expect(remapped?.map((w) => w.word)).toEqual(['The', 'FBI', 'closed', 'it', 'in', '1995.'])
  })

  it('gives the merged word the full spoken time window', () => {
    const { spokenText, spans } = preparePronunciation('FBI')
    const remapped = remapWordStamps(stampsFor(spokenText), spans) // F | B | I
    expect(remapped).toEqual([{ word: 'FBI', startSec: 0, endSec: 3 }])
  })

  it('survives a provider that tokenises differently from us', () => {
    const { spans } = preparePronunciation('It was 1995.')
    // Provider split the hyphenated word and emitted punctuation on its own.
    const stamps: WordStamp[] = [
      { word: 'It', startSec: 0, endSec: 1 },
      { word: 'was', startSec: 1, endSec: 2 },
      { word: 'nineteen', startSec: 2, endSec: 3 },
      { word: 'ninety', startSec: 3, endSec: 4 },
      { word: 'five', startSec: 4, endSec: 5 },
      { word: '.', startSec: 5, endSec: 5 },
    ]
    expect(remapWordStamps(stamps, spans)?.map((w) => w.word)).toEqual(['It', 'was', '1995.'])
  })

  it('returns undefined rather than guess when the timings do not line up', () => {
    const { spans } = preparePronunciation('The FBI closed it in 1995.')
    expect(remapWordStamps(stampsFor('something else entirely'), spans)).toBeUndefined()
    expect(remapWordStamps([], spans)).toBeUndefined()
  })

  it('returns undefined when the provider says more than we asked for', () => {
    const { spokenText, spans } = preparePronunciation('The FBI called.')
    expect(remapWordStamps(stampsFor(`${spokenText} extra words`), spans)).toBeUndefined()
  })

  it('round-trips a realistic mixed narration back to the original words', () => {
    const narration =
      'In 1995 the FBI reopened the Gaddafi file; by the 1980s, DNA had changed everything.'
    const { spokenText, spans } = preparePronunciation(narration)
    const remapped = remapWordStamps(stampsFor(spokenText), spans)
    expect(remapped?.map((w) => w.word).join(' ')).toBe(narration)
  })
})
