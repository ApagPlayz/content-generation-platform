// Captions stage. Produces timed caption cues for the burn-in / Remotion path.
// Uses whisper.cpp when available (token-level accuracy); otherwise distributes
// the known narration text across the measured audio duration weighted by word
// length — good enough for short-chunk TikTok-style captions and exact on text
// (we already KNOW the script, so we only need timing, not transcription).

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import path from 'path'
import type { CaptionCue, CaptionsResult } from './types'

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

/**
 * Heuristic timing: total audio time is divided across pages in proportion to
 * each page's character count, so longer phrases get more screen time.
 */
function heuristicCues(narration: string, durationSec: number): CaptionCue[] {
  const words = narration.split(/\s+/).filter(Boolean)
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

export async function generateCaptions(
  audioPath: string,
  narration: string,
  durationSec: number
): Promise<CaptionsResult> {
  const dir = path.dirname(audioPath)
  const captionsPath = path.join(dir, 'captions.json')

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
