// Unit tests for the pronunciation-normalization pass (issue #51). The voice was
// mispronouncing exactly the words these niches are built on — acronyms ("fibby"
// for FBI), tricky names, and year numbers. normalizeForSpeech() rewrites the
// text handed to the TTS engine while recording per-word { display, spoken }
// segments so captions can stay on the ORIGINAL spelling. These cases lock the
// transform rules and, critically, the invariant that segments always cover the
// text and mark exactly what changed — a regression there would leak "F B I"
// onto the screen (see captions.test.ts for the relabel side).

import { describe, expect, it } from 'vitest'
import { normalizeForSpeech, speechKey, type Lexicon } from './pronunciation'

const LEX: Lexicon = {
  respell: { worcester: 'WOOS-ter', gaddafi: 'guh-DAH-fee' },
  acronyms: ['DA'],
}

describe('normalizeForSpeech — acronyms', () => {
  it('spaces out an auto-detected acronym', () => {
    const r = normalizeForSpeech('The FBI raided the house', LEX)
    expect(r.spoken).toBe('The F B I raided the house')
    expect(r.changed).toBe(true)
  })

  it('strips dots from a dotted acronym', () => {
    expect(normalizeForSpeech('the C.I.A. knew', LEX).spoken).toBe('the C I A. knew')
  })

  it('leaves pronounceable acronyms (NASA) as words', () => {
    const r = normalizeForSpeech('NASA launched it', LEX)
    expect(r.spoken).toBe('NASA launched it')
    expect(r.changed).toBe(false)
  })

  it('never spaces a Roman numeral regnal name', () => {
    expect(normalizeForSpeech('Henry VIII reigned', LEX).spoken).toBe('Henry VIII reigned')
  })

  it('force-expands a lexicon acronym even though it is short', () => {
    expect(normalizeForSpeech('the DA said', LEX).spoken).toBe('the D A said')
  })
})

describe('normalizeForSpeech — lexicon respelling', () => {
  it('respells a known name, case-insensitively', () => {
    expect(normalizeForSpeech('Worcester and worcester', LEX).spoken).toBe('WOOS-ter and WOOS-ter')
  })

  it('keeps surrounding punctuation on a respelled word', () => {
    expect(normalizeForSpeech('It was Gaddafi.', LEX).spoken).toBe('It was guh-DAH-fee.')
  })

  it('respelling wins over the acronym rule', () => {
    // 'DA' is a forced acronym, but a respell entry for it would take precedence.
    const lex: Lexicon = { respell: { da: 'district attorney' }, acronyms: ['DA'] }
    expect(normalizeForSpeech('the DA', lex).spoken).toBe('the district attorney')
  })
})

describe('normalizeForSpeech — years and decades', () => {
  it('reads four-digit years the human way', () => {
    expect(normalizeForSpeech('in 1995', LEX).spoken).toBe('in nineteen ninety-five')
    expect(normalizeForSpeech('in 2010', LEX).spoken).toBe('in twenty ten')
    expect(normalizeForSpeech('in 2005', LEX).spoken).toBe('in two thousand five')
    expect(normalizeForSpeech('in 2000', LEX).spoken).toBe('in two thousand')
    expect(normalizeForSpeech('in 1900', LEX).spoken).toBe('in nineteen hundred')
  })

  it('reads decades', () => {
    expect(normalizeForSpeech('the 1980s were', LEX).spoken).toBe('the nineteen eighties were')
  })

  it('leaves non-year numbers alone', () => {
    // 3-digit and out-of-range numbers are not touched by the conservative rules.
    expect(normalizeForSpeech('room 237', LEX).spoken).toBe('room 237')
  })
})

describe('normalizeForSpeech — segments & invariants', () => {
  it('records display/spoken for changed words and identity for the rest', () => {
    const r = normalizeForSpeech('The FBI in 1995', LEX)
    expect(r.segments).toEqual([
      { display: 'The', spoken: 'The' },
      { display: 'FBI', spoken: 'F B I' },
      { display: 'in', spoken: 'in' },
      { display: '1995', spoken: 'nineteen ninety-five' },
    ])
  })

  it('is a no-op on plain prose (changed=false, spoken===input)', () => {
    const text = 'she opened the door slowly'
    const r = normalizeForSpeech(text, LEX)
    expect(r.changed).toBe(false)
    expect(r.spoken).toBe(text)
    expect(r.segments.every((s) => s.display === s.spoken)).toBe(true)
  })

  it('is idempotent — running twice equals running once', () => {
    const once = normalizeForSpeech('The FBI in 1995', LEX).spoken
    expect(normalizeForSpeech(once, LEX).spoken).toBe(once)
  })
})

describe('speechKey', () => {
  it('reduces a token to its comparable letters/digits', () => {
    expect(speechKey('raided.')).toBe('raided')
    expect(speechKey('F B I')).toBe('fbi')
    expect(speechKey('—')).toBe('')
  })
})
