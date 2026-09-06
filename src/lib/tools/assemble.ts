import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { existsSync } from 'fs'
import type { AssembleResult, MomentResult, ScriptResult } from './types'
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
  script: ScriptResult,
  opts: { outputName?: string } = {}
): Promise<AssembleResult> {
  // Defaults to final.mp4 — the short cut every platform used to share. The
  // TikTok long cut (issue #77) passes its own name so the two renders sit side
  // by side in the same media dir instead of overwriting each other.
  const outputName = opts.outputName ?? 'final.mp4'

  if ((process.env.RENDER_ENGINE || '').trim().toLowerCase() === 'remotion') {
    try {
      const { renderSportsHighlight } = await import('../render/remotion')
      return await renderSportsHighlight(sourcePath, moment, script, opts)
    } catch (err) {
      console.warn('[assemble] Remotion render failed, falling back to ffmpeg:', err)
    }
  }

  const dir = path.dirname(sourcePath)
  const outputPath = path.join(dir, outputName)
  const duration = moment.endSec - moment.startSec

  // drawtext chokes on unescaped quotes/colons.
  const hookText = script.hook.replace(/\\/g, '').replace(/'/g, '').replace(/:/g, '\\:')

  const filters = ['crop=ih*9/16:ih', 'scale=1080:1920']
  if (await hasDrawtext()) {
    filters.push(
      `drawtext=text='${hookText}':fontcolor=white:fontsize=56:borderw=3:bordercolor=black:x=(w-text_w)/2:y=180`
    )
  }

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

  if (!existsSync(outputPath)) throw new Error(`ffmpeg finished but ${outputName} not found`)
  return { outputPath, durationSec: duration }
}
