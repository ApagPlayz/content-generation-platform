// Assemble stage. Builds a 1080×1920 vertical video: a Ken-Burns (zoompan)
// slideshow over the sourced public-domain images, with the narration as the
// audio bed. Per-image clips are rendered then concat-muxed — robust and easy
// to reason about vs. one giant filter_complex. Captions are burned from a
// styled .ass file via the libass-backed `ass`/`subtitles` filter when the
// local ffmpeg has one; if the burn fails (or the filter is missing — this
// build often lacks libass) the video still ships, just uncaptioned. Either
// way captions.json is produced for the Remotion path. If ffmpeg is missing
// entirely, a timeline plan is written and rendered=false.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import type { CaptionsResult, RenderResult, ScriptBeat, TimelineSegment } from './types'
import { buildBeatTimeline } from './timeline'
import { buildBedSynthArgs, buildMixFilter, buildMusicEnvelope } from './musicBed'
import { kenBurnsClip } from './kenBurns'

const exec = promisify(execFile)
const FPS = 25

/** Optional per-beat inputs. When both are present (and yield a non-empty
 *  timeline) assemble stitches the resolved footage; otherwise it degrades to
 *  the even-split still slideshow below. */
export interface AssembleOpts {
  beats?: ScriptBeat[]
  beatFootage?: Record<number, string[]>
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await exec('which', ['ffmpeg'])
    return true
  } catch {
    return false
  }
}

/** Pick the best available libass-backed burn filter: `ass` renders the .ass
 *  file's own styles natively; `subtitles` is the broader fallback name. Null
 *  when the local build has neither (no libass) — captions then stay unburned.
 *  Filter names are matched at line start so a filter's description text (e.g.
 *  "Render ASS subtitles…") can't false-positive the check. */
async function subtitleBurnFilter(): Promise<'ass' | 'subtitles' | null> {
  try {
    const { stdout } = await exec('ffmpeg', ['-hide_banner', '-filters'])
    if (/^\s*[TSC.]+\s+ass\s/m.test(stdout)) return 'ass'
    if (/^\s*[TSC.]+\s+subtitles\s/m.test(stdout)) return 'subtitles'
    return null
  } catch {
    return null
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

/** Trim a source video clip to a uniform 1080×1920/25fps segment. `-an` drops
 *  any embedded audio so only the narration bed survives the final mux; params
 *  match renderImageClip's output so concat -c copy stays valid across a mixed
 *  video+still timeline. Many footage-ladder sources (archive.org transcodes,
 *  mood-bank clips) are small (320×240-class); a light hqdn3d denoise before
 *  the upscale plus a lanczos-filtered scale keeps the blow-up to 1080×1920
 *  reading as intentional grain rather than blocky compression artifacts. */
async function renderVideoClip(src: string, inSec: number, dur: number, out: string): Promise<boolean> {
  try {
    await exec(
      'ffmpeg',
      ['-y', '-ss', String(Math.max(0, inSec)), '-t', String(Math.max(0.1, dur)), '-i', src,
        '-vf', "hqdn3d=1.5:1.5:6:6,crop='min(iw,ih*9/16)':ih,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p", '-r', String(FPS),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-an', out],
      { timeout: 300_000 }
    )
    return existsSync(out)
  } catch {
    return false
  }
}

/** Measure a finished file's real duration (seconds) via ffprobe. Returns null
 *  when ffprobe is missing or the probe fails, so callers can tell "couldn't
 *  measure" apart from "measured too short" and never false-alarm a ship. */
async function ffprobeDurationSec(file: string): Promise<number | null> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { timeout: 30_000 }
    )
    const sec = parseFloat(stdout.trim())
    return Number.isFinite(sec) && sec > 0 ? sec : null
  } catch {
    return null
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

/** Write a styled .ass caption file next to the output for the burn step:
 *  bold sans, white fill with a black outline, centred in the lower third
 *  with safe margins on the 1080×1920 canvas. */
async function writeAss(captions: CaptionsResult, assPath: string): Promise<void> {
  const fmt = (s: number) => {
    // ASS timestamps are H:MM:SS.cc (centiseconds). Round on total centiseconds
    // so e.g. 1.999s becomes 0:00:02.00 rather than an invalid .100 field.
    const totalCs = Math.max(0, Math.round(s * 100))
    const cs = String(totalCs % 100).padStart(2, '0')
    const total = Math.floor(totalCs / 100)
    const hh = Math.floor(total / 3600)
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
    const ss = String(total % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}.${cs}`
  }
  // Braces would open libass override tags mid-narration; newlines become \N.
  const clean = (t: string) => t.replace(/[{}]/g, '').replace(/\s*\n\s*/g, '\\N')
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // White (&H00FFFFFF) over a black outline+shadow, Bold (-1), Alignment 2 =
    // bottom-centre, raised into the lower third by MarginV with 90px side margins.
    'Style: Caption,Arial,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,380,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const events = captions.cues.map(
    (c) => `Dialogue: 0,${fmt(c.startSec)},${fmt(c.endSec)},Caption,,0,0,0,,${clean(c.text)}`
  )
  await writeFile(assPath, header.concat(events).join('\n') + '\n')
}

export async function assembleVideo(
  imagePaths: string[],
  audioPath: string,
  audioDurationSec: number,
  captions: CaptionsResult,
  opts?: AssembleOpts
): Promise<RenderResult> {
  const dir = path.dirname(audioPath)
  const outputPath = path.join(dir, 'final.mp4')

  // Build the shared per-beat timeline when the footage ladder supplied clips.
  // Empty (no beats / no footage / nothing resolved) → we fall back to the
  // even-split still slideshow below, so nothing breaks when footage is off.
  const timeline: TimelineSegment[] =
    opts?.beats && opts.beats.length > 0 && opts.beatFootage && Object.keys(opts.beatFootage).length > 0
      ? buildBeatTimeline(opts.beats, opts.beatFootage, audioDurationSec)
      : []
  const useTimeline = timeline.length > 0

  // Preferred path: the Remotion karaoke composition (Ken-Burns slideshow +
  // word-by-word captions). Opt-in via RENDER_ENGINE=remotion; on any failure
  // we fall through to the ffmpeg slideshow below so the factory never stalls.
  if ((process.env.RENDER_ENGINE || '').trim().toLowerCase() === 'remotion') {
    try {
      const { renderTrueCrime } = await import('../render/remotion')
      return await renderTrueCrime(imagePaths, audioPath, audioDurationSec, captions, opts)
    } catch (err) {
      console.warn('[truecrime/assemble] Remotion render failed, falling back to ffmpeg:', err)
    }
  }

  if (!(await ffmpegAvailable())) {
    const planPath = path.join(dir, 'timeline.json')
    await writeFile(
      planPath,
      JSON.stringify(
        { imagePaths, audioPath, audioDurationSec, captions: captions.cues, timeline },
        null,
        2
      )
    )
    return { outputPath: null, durationSec: audioDurationSec, rendered: false, planPath }
  }

  // 1. Render the visual clips.
  const clipPaths: string[] = []
  if (useTimeline) {
    // Timeline-driven: a mix of trimmed video clips and Ken-Burns stills, each
    // normalised to identical 1080×1920/25fps/yuv420p params so concat stays valid.
    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i]
      const clip = path.join(dir, `seg-${String(i).padStart(3, '0')}.mp4`)
      let ok = false
      if (seg.kind === 'video') {
        ok = await renderVideoClip(seg.assetPath, seg.inSec ?? 0, seg.durationSec, clip)
      } else {
        ok = (await kenBurnsClip(seg.assetPath, seg.durationSec, { out: clip, fps: FPS })) !== ''
      }
      if (ok) clipPaths.push(clip)
    }
    // A partial timeline (some segment failed to render) would sum to LESS than
    // the narration, and the final `-shortest` mux would then cut the voice off
    // mid-story. Discard the partial render and use the even-split slideshow,
    // whose clips always cover the full audio duration.
    if (clipPaths.length !== timeline.length) clipPaths.length = 0
  }
  // Even-split still slideshow — the graceful fallback (also used if the
  // timeline produced zero usable segments). Like the timeline path above, this
  // must always cover the FULL narration: a partial track (some still failed to
  // render) sums to LESS than the audio, and the final `-shortest` mux would
  // then cut the voice off mid-story (issue #94). So if any still fails, we
  // re-render the survivors at a redistributed duration that still spans the
  // whole narration, rather than shipping a short track.
  if (clipPaths.length === 0 && imagePaths.length > 0) {
    const per = audioDurationSec / imagePaths.length
    const firstPass: string[] = []
    const survivors: string[] = [] // SOURCE images whose first render succeeded
    for (let i = 0; i < imagePaths.length; i++) {
      const clip = path.join(dir, `clip-${String(i).padStart(2, '0')}.mp4`)
      if (await renderImageClip(imagePaths[i], per, clip)) {
        firstPass.push(clip)
        survivors.push(imagePaths[i])
      }
    }
    if (survivors.length === imagePaths.length) {
      // Every still rendered — the first-pass clips already cover the full audio.
      clipPaths.push(...firstPass)
    } else if (survivors.length > 0) {
      // Partial: re-render only the survivors, each stretched so that
      // survivorCount × per2 === audioDurationSec (full narration coverage).
      const per2 = audioDurationSec / survivors.length
      for (let i = 0; i < survivors.length; i++) {
        const clip = path.join(dir, `restretch-${String(i).padStart(2, '0')}.mp4`)
        if (await renderImageClip(survivors[i], per2, clip)) clipPaths.push(clip)
      }
    }
    // survivors.length === 0 → clipPaths stays empty → colour fallback below.
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

  // 3. Caption burn (best-effort), then mux narration. Any failure preparing
  // or applying the burn falls back to the uncaptioned mux — the factory must
  // always ship a video.
  const burnArgs: string[] = []
  try {
    const burnFilter = await subtitleBurnFilter()
    if (burnFilter && captions.cues.length > 0) {
      const assPath = path.join(dir, 'captions.ass')
      await writeAss(captions, assPath)
      burnArgs.push('-vf', `${burnFilter}='${assPath.replace(/'/g, "'\\''")}'`)
    }
  } catch (err) {
    console.warn('[truecrime/assemble] caption prep failed, skipping burn:', err)
    burnArgs.length = 0
  }

  // 3a. Music bed: synthesise an ORIGINAL ambient drone (100% ffmpeg-generated →
  // monetization-safe, no asset, no network) and pre-mix it UNDER the narration
  // at the levels the beats' `musicIntensity` curve already specifies. This is a
  // SEPARATE audio-only step (ffmpeg forbids `-vf` + `-filter_complex` together,
  // and the mux below uses `-vf` for the caption burn), so the mux is unchanged
  // apart from reading `audioForMux`. Any failure keeps narration-only — the
  // factory always ships, silent bed or not.
  let audioForMux = audioPath
  if (opts?.beats && opts.beats.length > 0) {
    try {
      const bedPath = path.join(dir, 'music-bed.wav')
      await exec('ffmpeg', buildBedSynthArgs(audioDurationSec, bedPath), { timeout: 300_000 })
      if (existsSync(bedPath)) {
        const mixedPath = path.join(dir, 'mixed.m4a')
        const env = buildMusicEnvelope(opts.beats, audioDurationSec)
        await exec(
          'ffmpeg',
          ['-y', '-i', audioPath, '-i', bedPath,
            '-filter_complex', buildMixFilter(env),
            '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', mixedPath],
          { timeout: 300_000 }
        )
        if (existsSync(mixedPath)) audioForMux = mixedPath
      }
    } catch (err) {
      console.warn('[truecrime/assemble] music bed failed, using narration only:', err)
    }
  }

  const mux = (extra: string[]) =>
    exec(
      'ffmpeg',
      ['-y', '-i', silentVideo, '-i', audioForMux, ...extra,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', extra.length ? 'libx264' : 'copy', ...(extra.length ? ['-preset', 'fast', '-crf', '21'] : []),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-movflags', '+faststart', '-shortest', outputPath],
      { timeout: 300_000 }
    )

  try {
    await mux(burnArgs)
  } catch (err) {
    // The plain mux failing is fatal exactly as before; a failed BURN is not.
    if (burnArgs.length === 0) throw err
    console.warn('[truecrime/assemble] caption burn failed, retrying without captions:', err)
    await mux([])
  }

  if (!existsSync(outputPath)) {
    return { outputPath: null, durationSec: audioDurationSec, rendered: false }
  }
  // Probe the ACTUAL muxed duration so the finalize gate can catch a render the
  // `-shortest` mux clipped short of the narration. `durationSec` stays the
  // intended length (it's persisted as the video's duration); the measured
  // value is a separate belt-and-braces signal.
  const measured = await ffprobeDurationSec(outputPath)
  return {
    outputPath,
    durationSec: audioDurationSec,
    rendered: true,
    ...(measured != null ? { measuredDurationSec: measured } : {}),
  }
}
