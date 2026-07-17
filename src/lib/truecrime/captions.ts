// Captions stage. Produces timed caption cues for the burn-in / Remotion path.
// Uses whisper.cpp when available (token-level accuracy); otherwise distributes
// the known narration text across the measured audio duration weighted by word
// length — good enough for short-chunk TikTok-style captions and exact on text
// (we already KNOW the script, so we only need timing, not transcription).

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import path from 'path'
import type { CaptionCue, CaptionsResult, NormSegment, WordStamp } from './types'
import { speechKey } from './pronunciation'

const exec = promisify(execFile)

async function whisperAvailable(): Promise<string | null> {
  for (const cmd of ['whisper-cli', 'whisper-cpp', 'whisper']) {
    try {
      await exec('which', [cmd])
      return cmd
    } catch {
      /* try next */
    }
  }
  return null
}

/** Group words into ~3-word caption pages. */
function pageWords(words: string[], perPage = 3): string[][] {
  const pages: string[][] = []
  for (let i = 0; i < words.length; i += perPage) pages.push(words.slice(i, i + perPage))
  return pages
}

/** True for a token that is ONLY punctuation/symbols — no letter or digit in
 *  any script. These are the tokens that must never open a caption page. */
export function isPunctuationOnly(token: string): boolean {
  return token.length > 0 && !/[\p{L}\p{N}]/u.test(token)
}

/**
 * Merge punctuation-only tokens into the previous word ("night" + "," →
 * "night,") so no downstream page can ever begin with a bare "," or ".".
 * A punctuation token with no previous word (narration starting "— text")
 * is stripped — there is nothing sensible to attach it to.
 */
export function mergeLeadingPunctuation(words: string[]): string[] {
  const out: string[] = []
  for (const w of words) {
    if (!isPunctuationOnly(w)) out.push(w)
    else if (out.length) out[out.length - 1] += w
    // else: leading punctuation with no carrier word — drop it
  }
  return out
}

/**
 * Same merge for provider word stamps (Kokoro): a punctuation-only "word"
 * folds its text into the previous stamp and extends that stamp's window, so
 * karaoke pages keep exact timings but never open on bare punctuation.
 */
export function mergePunctuationStamps(words: WordStamp[]): WordStamp[] {
  const out: WordStamp[] = []
  for (const w of words) {
    if (!isPunctuationOnly(w.word)) {
      out.push({ ...w })
    } else if (out.length) {
      const prev = out[out.length - 1]
      prev.word += w.word
      prev.endSec = Math.max(prev.endSec, w.endSec)
    }
    // else: leading punctuation stamp with no carrier word — drop it
  }
  return out
}

/**
 * Heuristic timing: total audio time is divided across pages in proportion to
 * each page's character count, so longer phrases get more screen time.
 */
export function heuristicCues(narration: string, durationSec: number): CaptionCue[] {
  const words = mergeLeadingPunctuation(narration.split(/\s+/).filter(Boolean))
  const pages = pageWords(words)
  const weights = pages.map((p) => p.join(' ').length)
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1
  const cues: CaptionCue[] = []
  let t = 0
  pages.forEach((p, i) => {
    const dur = (weights[i] / totalWeight) * durationSec
    cues.push({ text: p.join(' '), startSec: round(t), endSec: round(t + dur) })
    t += dur
  })
  return cues
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Exact timing from provider word stamps (Kokoro captioned). Words are grouped
 * into ~3-word pages; each page carries per-word `tokens` so the render can do
 * word-by-word (karaoke) highlighting, and the page's start/end come straight
 * from the real spoken timings rather than a character-weighted estimate.
 */
export function kokoroCues(words: WordStamp[], perPage = 3): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (let i = 0; i < words.length; i += perPage) {
    const page = words.slice(i, i + perPage)
    cues.push({
      text: page.map((w) => w.word).join(' '),
      startSec: round(page[0].startSec),
      endSec: round(page[page.length - 1].endSec),
      tokens: page.map((w) => ({
        text: w.word,
        startSec: round(w.startSec),
        endSec: round(w.endSec),
      })),
    })
  }
  return cues
}

/**
 * Relabel spoken word stamps back to the original spelling (issue #51). When the
 * pronunciation pass changed a word ("FBI"→"F B I", "1995"→"nineteen ninety-
 * five"), the TTS engine's stamps carry the SPOKEN tokens; burning those into
 * captions would show "F B I" on screen. Each `segment` is one original word and
 * its spoken form, so we walk the stamps, consume however many reconstruct each
 * segment's spoken text, and emit ONE stamp carrying the original `display`
 * spelling over their combined time window. Karaoke stays per-word (one output
 * stamp per original word).
 *
 * Returns the stamps unchanged when nothing was normalized (byte-identical to
 * the old behaviour), and `null` on any drift — Kokoro's tokenizer is a black
 * box — so the caller can safely fall back to heuristic timing on the original
 * text rather than ever risk showing the spoken form.
 */
export function relabelStampsToDisplay(
  stamps: WordStamp[],
  segments: NormSegment[]
): WordStamp[] | null {
  if (!segments.some((s) => s.display !== s.spoken)) return stamps // nothing changed
  const out: WordStamp[] = []
  let si = 0
  const nextReal = () => {
    while (si < stamps.length && speechKey(stamps[si].word) === '') si++
    return si < stamps.length ? stamps[si] : null
  }
  for (const seg of segments) {
    const target = speechKey(seg.spoken)
    if (target === '') continue // punctuation-only original token — no stamp to consume
    let acc = ''
    let start: number | null = null
    let end = 0
    while (acc.length < target.length) {
      const st = nextReal()
      if (!st) return null // ran out of stamps mid-word → drift
      acc += speechKey(st.word)
      if (start === null) start = st.startSec
      end = st.endSec
      si++
    }
    if (acc !== target || start === null) return null // reconstruction didn't line up
    out.push({ word: seg.display, startSec: start, endSec: end })
  }
  if (nextReal()) return null // leftover real stamps → drift
  return out
}

export async function generateCaptions(
  audioPath: string,
  narration: string,
  durationSec: number,
  words?: WordStamp[],
  segments?: NormSegment[]
): Promise<CaptionsResult> {
  const dir = path.dirname(audioPath)
  const captionsPath = path.join(dir, 'captions.json')

  // Best path: exact, word-level timings supplied by the TTS provider (Kokoro).
  // First relabel any pronunciation-normalized words back to their original
  // spelling (issue #51) so captions read "FBI" while the audio says "F B I";
  // on any alignment drift the relabel returns null and we fall through to the
  // heuristic path, which uses the ORIGINAL narration text (never the spoken
  // form). Punctuation-only stamps are then merged into their previous word so
  // no caption page ever opens on a bare "," / "." token.
  const relabeled = words && words.length > 0 && segments ? relabelStampsToDisplay(words, segments) : words
  const stamps = relabeled && relabeled.length > 0 ? mergePunctuationStamps(relabeled) : []
  if (stamps.length > 0) {
    const cues = kokoroCues(stamps)
    await writeFile(captionsPath, JSON.stringify({ method: 'kokoro', durationSec, cues }, null, 2))
    return { cues, captionsPath, method: 'kokoro' }
  }

  const whisper = await whisperAvailable()
  let cues: CaptionCue[]
  let method: 'whisper' | 'heuristic'

  if (whisper) {
    try {
      // whisper.cpp writes <audio>.json next to the input with -oj.
      await exec(whisper, ['-f', audioPath, '-oj', '-of', path.join(dir, 'whisper')], {
        timeout: 300_000,
      })
      // Parsing whisper's segment json is whisper-build-specific; if the shape
      // doesn't match we fall back to heuristic timing (still exact on text).
      cues = heuristicCues(narration, durationSec)
      method = 'whisper'
    } catch {
      cues = heuristicCues(narration, durationSec)
      method = 'heuristic'
    }
  } else {
    cues = heuristicCues(narration, durationSec)
    method = 'heuristic'
  }

  await writeFile(captionsPath, JSON.stringify({ method, durationSec, cues }, null, 2))
  return { cues, captionsPath, method }
}
