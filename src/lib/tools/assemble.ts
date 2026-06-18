import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { existsSync } from 'fs'
import type { AssembleResult, MomentResult, ScriptResult } from './types'
import { isRemotionEnabled, renderSportsHighlight } from '../render/remotion'

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
  script: ScriptResult
): Promise<AssembleResult> {
  if (isRemotionEnabled()) {
    try {
      return await renderSportsHighlight(sourcePath, moment, script)
    } catch (err) {
      console.warn('[assemble] Remotion render failed, falling back to ffmpeg:', err)
    }
  }

  const dir = path.dirname(sourcePath)
  const outputPath = path.join(dir, 'final.mp4')
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

  if (!existsSync(outputPath)) throw new Error('ffmpeg finished but final.mp4 not found')
  return { outputPath, durationSec: duration }
}
