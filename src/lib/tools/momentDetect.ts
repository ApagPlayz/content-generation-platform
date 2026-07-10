import { execFile } from 'child_process'
import { promisify } from 'util'
import type { MomentResult } from './types'

const exec = promisify(execFile)

/**
 * Find the most highlight-worthy window in the source reel.
 *
 * v1 heuristic: loudest sustained audio window (crowd roar + commentator
 * excitement proxy), computed from ffmpeg per-second RMS levels. A trained
 * CNN scorer can replace this behind the same interface later.
 */
export async function runMomentDetect(
  sourcePath: string,
  durationSec: number,
  clipLengthSec = 20
): Promise<MomentResult> {
  try {
    const { stderr } = await exec(
      'ffmpeg',
      [
        '-i', sourcePath,
        '-af', 'astats=metadata=1:reset=1:length=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
        '-f', 'null', '-',
      ],
      { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
    )

    // Parse "pts_time:<t>" / "lavfi.astats.Overall.RMS_level=<db>" pairs.
    const levels: { t: number; db: number }[] = []
    let currentT = 0
    for (const line of stderr.split('\n')) {
      const tMatch = line.match(/pts_time:([\d.]+)/)
      if (tMatch) currentT = parseFloat(tMatch[1])
      const dbMatch = line.match(/RMS_level=(-?[\d.]+|nan)/)
      if (dbMatch && dbMatch[1] !== 'nan') {
        levels.push({ t: currentT, db: parseFloat(dbMatch[1]) })
      }
    }

    if (levels.length > clipLengthSec) {
      // Sliding window: maximize mean RMS over clipLengthSec seconds.
      // Skip the first 10s (intros) and last 10s (outros).
      const usable = levels.filter(
        (l) => l.t >= 10 && l.t <= Math.max(durationSec - 10, 10)
      )
      let best = { start: usable[0]?.t ?? 0, mean: -Infinity }
      for (let i = 0; i < usable.length; i++) {
        const windowEnd = usable[i].t + clipLengthSec
        const window = []
        for (let j = i; j < usable.length && usable[j].t < windowEnd; j++) {
          window.push(usable[j].db)
        }
        if (window.length < clipLengthSec * 0.5) continue
        const mean = window.reduce((a, b) => a + b, 0) / window.length
        if (mean > best.mean) best = { start: usable[i].t, mean }
      }
      if (best.mean > -Infinity) {
        return {
          startSec: Math.round(best.start),
          endSec: Math.round(best.start + clipLengthSec),
          method: 'audio_energy',
        }
      }
    }
  } catch {
    // ffmpeg missing or parse failure — fall through to fixed window.
  }

  // Fallback: a window past the intro.
  const start = Math.min(30, Math.max(0, durationSec - clipLengthSec))
  return { startSec: start, endSec: start + clipLengthSec, method: 'fixed_window' }
}
