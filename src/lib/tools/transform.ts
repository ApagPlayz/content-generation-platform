import { execFile } from 'child_process'
import { promisify } from 'util'
import { copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { MomentResult, ScriptResult, TransformResult } from './types'

const exec = promisify(execFile)

// ---------------------------------------------------------------------------
// The transform stage turns a raw windowed re-upload of someone else's reel
// into a genuinely transformative edit: a punch-in reframe, an optional slow-mo
// on the climax, telestration spotlight boxes, and our OWN commentary/analysis
// burned as timed lower-thirds. Everything is ffmpeg-only (no new deps, no
// keys) and degrades gracefully — any filter/tool that isn't available is
// skipped rather than failing the run. If nothing can be produced (no ffmpeg)
// runTransform returns null and the pipeline falls back to the raw window.
// ---------------------------------------------------------------------------

interface TransformConfig {
  enabled?: boolean
  punchIn?: boolean
  slowMoPeak?: boolean
  telestration?: boolean
  commentaryOverlay?: boolean
  editStyle?: string
}

const SLOW_FACTOR = 0.5 // climax runs at half speed

let ffmpegAvailable: boolean | null = null
let ffprobeAvailable: boolean | null = null
let drawtextAvailable: boolean | null = null

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await exec('which', [cmd])
    return true
  } catch {
    return false
  }
}

// Homebrew's ffmpeg bottle may be built without libfreetype (no drawtext);
// telestration boxes (drawbox) still work, only text labels are skipped.
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

// drawtext chokes on unescaped quotes/colons; commas/brackets break the
// filtergraph when passed inline. Strip/escape the problematic characters.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '')
    .replace(/'/g, '')
    .replace(/[,[\]%]/g, ' ')
    .replace(/:/g, '\\:')
    .trim()
    .slice(0, 90)
}

/**
 * Real duration of a rendered file, or `fallback` when ffprobe is unavailable.
 * Exported so the TikTok long cut (issue #77) can verify it actually cleared
 * the 60s payout floor instead of trusting the length we asked ffmpeg for.
 */
export async function probeDuration(file: string, fallback: number): Promise<number> {
  if (ffprobeAvailable === null) ffprobeAvailable = await commandExists('ffprobe')
  if (!ffprobeAvailable) return fallback
  try {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ])
    const d = Number(String(stdout).trim())
    return Number.isFinite(d) && d > 0 ? d : fallback
  } catch {
    return fallback
  }
}

const num = (n: number) => n.toFixed(3)

/**
 * Produce media/<videoId>/treated.mp4: the detected window with an edit
 * treatment + overlays burned in. Two passes so time-warping (slow-mo) and
 * text timing stay decoupled — the overlay pass times its enable windows
 * against the ACTUAL edited duration (from ffprobe), never a guess.
 *
 * Returns null only when ffmpeg is entirely absent, so the caller can fall
 * back to the raw source + original moment.
 */
export async function runTransform(
  sourcePath: string,
  moment: MomentResult,
  script: ScriptResult,
  factoryConfig: Record<string, unknown>
): Promise<TransformResult | null> {
  if (ffmpegAvailable === null) ffmpegAvailable = await commandExists('ffmpeg')
  if (!ffmpegAvailable) return null
  if (!existsSync(sourcePath)) return null

  const cfg = (factoryConfig.transform ?? {}) as TransformConfig
  const wantPunchIn = cfg.punchIn !== false
  const wantSlowMo = cfg.slowMoPeak !== false
  const wantTelestration = cfg.telestration !== false
  const wantCommentary = cfg.commentaryOverlay !== false

  const dir = path.dirname(sourcePath)
  const editedPath = path.join(dir, 'edited.mp4')
  const treatedPath = path.join(dir, 'treated.mp4')

  const windowDur = Math.max(1, moment.endSec - moment.startSec)
  // Climax sub-window: a short slice past the middle of the clip.
  const climaxStart = windowDur * 0.55
  const climaxEnd = Math.min(windowDur * 0.72, climaxStart + 3)

  const treatments: string[] = []

  // ---- Pass 1: the edit (slow-mo + punch-in) -> edited.mp4 ------------------
  let editOk = false
  if (wantSlowMo) {
    try {
      await buildSlowMoEdit(sourcePath, editedPath, moment.startSec, windowDur, climaxStart, climaxEnd, wantPunchIn)
      treatments.push('slow-mo-peak')
      if (wantPunchIn) treatments.push('punch-in')
      editOk = true
    } catch {
      /* cascade to zoom-only */
    }
  }
  if (!editOk && wantPunchIn) {
    try {
      await buildZoomEdit(sourcePath, editedPath, moment.startSec, windowDur)
      treatments.push('punch-in')
      editOk = true
    } catch {
      /* cascade to plain recut */
    }
  }
  if (!editOk) {
    try {
      await buildRecut(sourcePath, editedPath, moment.startSec, windowDur)
      treatments.push('recut')
      editOk = true
    } catch {
      // Nothing worked — no treated file can be produced.
      return null
    }
  }

  // Real duration of the edited clip (slow-mo lengthens it).
  const expectedDur = wantSlowMo && treatments.includes('slow-mo-peak')
    ? windowDur + (climaxEnd - climaxStart) * (1 / SLOW_FACTOR - 1)
    : windowDur
  const editedDur = await probeDuration(editedPath, expectedDur)

  // ---- Pass 2: overlays (telestration + commentary) -> treated.mp4 ---------
  const hasText = await hasDrawtext()
  const overlayFilters: string[] = []
  let telestrationCount = 0
  let analysisLines = 0

  if (wantTelestration) {
    const spots =
      script.telestration && script.telestration.length > 0
        ? script.telestration
        : [{ label: 'KEY PLAY', atSec: undefined as number | undefined }]
    for (const spot of spots.slice(0, 3)) {
      const at =
        spot.atSec != null && Number.isFinite(spot.atSec)
          ? Math.min(Math.max(spot.atSec, 0.5), Math.max(editedDur - 1, 0.5))
          : editedDur * 0.6
      const a = Math.max(0, at - 0.5)
      const b = Math.min(editedDur, at + 2.5)
      // Spotlight rectangle (outline) — kept in the center-safe band because
      // assemble center-crops to 9:16 afterwards.
      overlayFilters.push(
        `drawbox=x=iw*0.32:y=ih*0.30:w=iw*0.36:h=ih*0.30:color=yellow@0.9:t=5:enable='between(t,${num(a)},${num(b)})'`
      )
      telestrationCount++
      if (hasText && spot.label) {
        overlayFilters.push(
          `drawtext=text='${escapeText(spot.label)}':fontcolor=yellow:fontsize=44:borderw=3:bordercolor=black:x=(w-text_w)/2:y=ih*0.24:enable='between(t,${num(a)},${num(b)})'`
        )
      }
    }
  }

  if (wantCommentary && hasText && script.analysis && script.analysis.length > 0) {
    const lines = script.analysis.slice(0, 4)
    const slot = editedDur / lines.length
    lines.forEach((line, i) => {
      const a = i * slot
      const b = (i + 1) * slot
      // Lower-third: horizontally centered (survives the center-crop), sat in a
      // dark box for legibility over any footage.
      overlayFilters.push(
        `drawtext=text='${escapeText(line)}':fontcolor=white:fontsize=40:borderw=2:bordercolor=black:box=1:boxcolor=black@0.5:boxborderw=12:x=(w-text_w)/2:y=h*0.74:enable='between(t,${num(a)},${num(b)})'`
      )
      analysisLines++
    })
  }

  if (overlayFilters.length === 0) {
    // No overlays to burn — the edited clip IS the treated clip.
    await copyFile(editedPath, treatedPath)
  } else {
    try {
      await exec(
        'ffmpeg',
        [
          '-y',
          '-i', editedPath,
          '-vf', overlayFilters.join(','),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '21',
          '-c:a', 'copy',
          treatedPath,
        ],
        { timeout: 600_000 }
      )
      if (!existsSync(treatedPath)) throw new Error('overlay pass produced no file')
      if (telestrationCount > 0) treatments.push('telestration')
      if (analysisLines > 0) treatments.push('commentary')
    } catch {
      // Overlay burn failed — fall back to the edited clip (still transformed).
      telestrationCount = 0
      analysisLines = 0
      await copyFile(editedPath, treatedPath)
    }
  }

  if (!existsSync(treatedPath)) return null

  const durationSec = await probeDuration(treatedPath, editedDur)
  return {
    treatedPath,
    durationSec,
    treatments,
    telestrationCount,
    analysisLines,
  }
}

const V_CODEC = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '21']
const A_CODEC = ['-c:a', 'aac', '-b:a', '128k']

// A gentle static punch-in: scale up ~8% then crop back to the original frame,
// centered — a tighter reframe that reads as an edit, no per-frame expressions
// (reliable across ffmpeg builds).
const PUNCH_IN_VF = 'scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08'

async function buildRecut(
  src: string,
  out: string,
  start: number,
  dur: number
): Promise<void> {
  await exec(
    'ffmpeg',
    ['-y', '-ss', num(start), '-t', num(dur), '-i', src, ...V_CODEC, ...A_CODEC, out],
    { timeout: 600_000 }
  )
  if (!existsSync(out)) throw new Error('recut produced no file')
}

async function buildZoomEdit(
  src: string,
  out: string,
  start: number,
  dur: number
): Promise<void> {
  await exec(
    'ffmpeg',
    ['-y', '-ss', num(start), '-t', num(dur), '-i', src, '-vf', PUNCH_IN_VF, ...V_CODEC, ...A_CODEC, out],
    { timeout: 600_000 }
  )
  if (!existsSync(out)) throw new Error('zoom edit produced no file')
}

// Split the window into pre/climax/post, slow the climax (video setpts + audio
// atempo stay in lock-step), concat, then optionally punch in. Requires an
// audio stream in the source; if there is none this throws and the caller
// cascades to the zoom-only edit.
async function buildSlowMoEdit(
  src: string,
  out: string,
  start: number,
  dur: number,
  cs: number,
  ce: number,
  punchIn: boolean
): Promise<void> {
  const slowPts = 1 / SLOW_FACTOR // 0.5 -> 2.0
  const post = punchIn ? `[vc]${PUNCH_IN_VF}[vout]` : `[vc]copy[vout]`
  const filter = [
    `[0:v]trim=0:${num(cs)},setpts=PTS-STARTPTS[v0]`,
    `[0:v]trim=${num(cs)}:${num(ce)},setpts=(PTS-STARTPTS)*${num(slowPts)}[v1]`,
    `[0:v]trim=${num(ce)},setpts=PTS-STARTPTS[v2]`,
    `[v0][v1][v2]concat=n=3:v=1:a=0[vc]`,
    post,
    `[0:a]atrim=0:${num(cs)},asetpts=PTS-STARTPTS[a0]`,
    `[0:a]atrim=${num(cs)}:${num(ce)},asetpts=PTS-STARTPTS,atempo=${num(SLOW_FACTOR)}[a1]`,
    `[0:a]atrim=${num(ce)},asetpts=PTS-STARTPTS[a2]`,
    `[a0][a1][a2]concat=n=3:v=0:a=1[aout]`,
  ].join(';')

  await exec(
    'ffmpeg',
    [
      '-y',
      '-ss', num(start), '-t', num(dur), '-i', src,
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '[aout]',
      ...V_CODEC, ...A_CODEC,
      out,
    ],
    { timeout: 600_000 }
  )
  if (!existsSync(out)) throw new Error('slow-mo edit produced no file')
}
