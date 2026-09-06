import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { existsSync } from 'fs'
import type { AssembleResult, MomentResult, ScriptResult } from './types'
import { drawtextValue } from './ffmpegText'
// NB: ../render/remotion is loaded with a dynamic import() below, never a static
// one. It (transitively) pulls @remotion/bundler → @rspack's native .node binary,
// which can't be compiled for the browser/edge. A static import drags that graph
// into Next's eager dev/edge compilation and crashes every pipeline route. The
// dynamic import keeps it a server-only, on-demand chunk loaded only when the
// RENDER_ENGINE=remotion flag is actually set.

const exec = promisify(execFile)

let drawtextAvailable: boolean | null = null

// Homebrew's ffmpeg bottle may be built without libfreetype (no drawtext).
async function hasDrawtext(): Promise<boolean> {
  if (drawtextAvailable === null) {
    try {
      const { stdout } = await exec('ffmpeg', ['-hide_banner', '-filters'])
      drawtextAvailable = stdout.includes('drawtext')
    } catch {
      drawtextAvailable = false
    }
  }
  return drawtextAvailable
}

/**
 * The burned-in hook caption filter, or null when there is nothing to draw.
 *
 * Exported so a test can pin the two things that must never regress: the
 * `expansion=none` (without it a `%` in the hook silently draws nothing) and the
 * fully-escaped, UNQUOTED text value. See ./ffmpegText for why both matter.
 */
export function hookCaptionFilter(hook: string): string | null {
  const text = drawtextValue(hook)
  if (!text) return null
  return `drawtext=expansion=none:text=${text}:fontcolor=white:fontsize=56:borderw=3:bordercolor=black:x=(w-text_w)/2:y=180`
}

/**
 * Cut the detected moment and crop to 9:16 vertical with the hook caption.
 *
 * Two render engines behind one interface: when RENDER_ENGINE=remotion the
 * Remotion template (animated word-by-word hook, proper framing) runs; on any
 * failure — or by default — we fall back to the ffmpeg `drawtext` path below,
 * so the unattended factory never stalls while we validate Remotion.
 */
export async function runAssemble(
  sourcePath: string,
  moment: MomentResult,
  script: ScriptResult
): Promise<AssembleResult> {
  if ((process.env.RENDER_ENGINE || '').trim().toLowerCase() === 'remotion') {
    try {
      const { renderSportsHighlight } = await import('../render/remotion')
      return await renderSportsHighlight(sourcePath, moment, script)
    } catch (err) {
      console.warn('[assemble] Remotion render failed, falling back to ffmpeg:', err)
    }
  }

  const dir = path.dirname(sourcePath)
  const outputPath = path.join(dir, 'final.mp4')
  const duration = moment.endSec - moment.startSec

  const filters = ['crop=ih*9/16:ih', 'scale=1080:1920']
  const caption = hookCaptionFilter(script.hook)
  if (caption && (await hasDrawtext())) filters.push(caption)

  await exec(
    'ffmpeg',
    [
      '-y',
      '-ss', String(moment.startSec),
      '-t', String(duration),
      '-i', sourcePath,
      '-vf', filters.join(','),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '21',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ],
    { timeout: 600_000 }
  )

  if (!existsSync(outputPath)) throw new Error('ffmpeg finished but final.mp4 not found')
  return { outputPath, durationSec: duration }
}
