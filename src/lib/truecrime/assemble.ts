// Assemble stage. Builds a 1080×1920 vertical video: a Ken-Burns (zoompan)
// slideshow over the sourced public-domain images, with the narration as the
// audio bed. Per-image clips are rendered then concat-muxed — robust and easy
// to reason about vs. one giant filter_complex. Captions are burned only if the
// local ffmpeg has the `subtitles`/`drawtext` filter (this build often doesn't);
// either way captions.json is produced for the Remotion path. If ffmpeg is
// missing entirely, a timeline plan is written and rendered=false.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { CaptionsResult, RenderResult } from './types'

const exec = promisify(execFile)
const FPS = 25

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await exec('which', ['ffmpeg'])
    return true
  } catch {
    return false
  }
}

async function hasSubtitlesFilter(): Promise<boolean> {
  try {
    const { stdout } = await exec('ffmpeg', ['-hide_banner', '-filters'])
    return /\bsubtitles\b/.test(stdout)
  } catch {
    return false
  }
}

/** Render one still into a zoompan motion clip of `dur` seconds. */
async function renderImageClip(img: string, dur: number, out: string): Promise<boolean> {
  const frames = Math.max(1, Math.round(dur * FPS))
  const vf =
    'scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,' +
    `zoompan=z='min(zoom+0.0012,1.18)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS},` +
    'setsar=1,format=yuv420p'
  try {
    await exec(
      'ffmpeg',
      ['-y', '-loop', '1', '-i', img, '-t', String(dur), '-r', String(FPS), '-vf', vf,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-an', out],
      { timeout: 300_000 }
    )
    return existsSync(out)
  } catch {
    return false
  }
}

/** Solid-colour fallback clip when no images were sourced. */
async function renderColorClip(dur: number, out: string): Promise<boolean> {
  try {
    await exec(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `color=c=0x111418:s=1080x1920:r=${FPS}:d=${dur}`,
        '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', out],
      { timeout: 120_000 }
    )
    return existsSync(out)
  } catch {
    return false
  }
}

/** Write an SRT next to the output for the optional subtitles burn. */
async function writeSrt(captions: CaptionsResult, srtPath: string): Promise<void> {
  const fmt = (s: number) => {
    const ms = Math.round((s % 1) * 1000)
    const total = Math.floor(s)
    const hh = String(Math.floor(total / 3600)).padStart(2, '0')
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
    const ss = String(total % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss},${String(ms).padStart(3, '0')}`
  }
  const body = captions.cues
    .map((c, i) => `${i + 1}\n${fmt(c.startSec)} --> ${fmt(c.endSec)}\n${c.text}\n`)
    .join('\n')
  await writeFile(srtPath, body)
}

export async function assembleVideo(
  imagePaths: string[],
  audioPath: string,
  audioDurationSec: number,
  captions: CaptionsResult
): Promise<RenderResult> {
  const dir = path.dirname(audioPath)
  const outputPath = path.join(dir, 'final.mp4')

  if (!(await ffmpegAvailable())) {
    const planPath = path.join(dir, 'timeline.json')
    await writeFile(
      planPath,
      JSON.stringify({ imagePaths, audioPath, audioDurationSec, captions: captions.cues }, null, 2)
    )
    return { outputPath: null, durationSec: audioDurationSec, rendered: false, planPath }
  }

  // 1. Per-image (or fallback colour) clips.
  const clipPaths: string[] = []
  if (imagePaths.length > 0) {
    const per = audioDurationSec / imagePaths.length
    for (let i = 0; i < imagePaths.length; i++) {
      const clip = path.join(dir, `clip-${String(i).padStart(2, '0')}.mp4`)
      if (await renderImageClip(imagePaths[i], per, clip)) clipPaths.push(clip)
    }
  }
  if (clipPaths.length === 0) {
    const clip = path.join(dir, 'clip-bg.mp4')
    if (await renderColorClip(audioDurationSec, clip)) clipPaths.push(clip)
  }
  if (clipPaths.length === 0) {
    return { outputPath: null, durationSec: audioDurationSec, rendered: false }
  }

  // 2. Concat the visual clips.
  const concatList = path.join(dir, 'concat.txt')
  await writeFile(concatList, clipPaths.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'))
  const silentVideo = path.join(dir, 'slideshow.mp4')
  try {
    await exec(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', silentVideo],
      { timeout: 300_000 }
    )
  } catch {
    // Concat-copy can fail if a clip's params drift — re-encode as a fallback.
    await exec(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', silentVideo],
      { timeout: 300_000 }
    )
  }
  if (!existsSync(silentVideo)) {
    return { outputPath: null, durationSec: audioDurationSec, rendered: false }
  }

  // 3. Optional caption burn, then mux narration.
  const burnArgs: string[] = []
  if (await hasSubtitlesFilter()) {
    const srt = path.join(dir, 'captions.srt')
    await writeSrt(captions, srt)
    burnArgs.push('-vf', `subtitles='${srt.replace(/'/g, "'\\''")}'`)
  }

  await exec(
    'ffmpeg',
    ['-y', '-i', silentVideo, '-i', audioPath, ...burnArgs,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', burnArgs.length ? 'libx264' : 'copy', ...(burnArgs.length ? ['-preset', 'fast', '-crf', '21'] : []),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-shortest', outputPath],
    { timeout: 300_000 }
  )

  if (!existsSync(outputPath)) {
    return { outputPath: null, durationSec: audioDurationSec, rendered: false }
  }
  return { outputPath, durationSec: audioDurationSec, rendered: true }
}
