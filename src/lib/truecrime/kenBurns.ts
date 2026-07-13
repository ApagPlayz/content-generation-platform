// Ken-Burns render helpers, extracted so both the slideshow assembler and any
// per-beat assembler animate stills through ONE code path. `kenBurnsClip`
// renders a single still into a slow zoompan motion clip; `solidColorClip` is
// the keyless lavfi fallback when there's no usable image. For tall sources the
// ffmpeg args are byte-for-byte equivalent to the inline renderImageClip/
// renderColorClip that used to live in assemble.ts (default fps 25, 1080×1920,
// crf 21/23). Wide/4:3 sources (aspect > 3:4) instead render "contained" — a
// blurred fill of the same image behind the sharp fit-width original — because
// cropping them to fill 9:16 produced unreadable extreme zooms.
//
// Pure helpers: no Prisma, no orchestrator wiring, no network. fps is a
// parameter (ffmpeg uses 25, Remotion 30) so Ken-Burns timing stays correct on
// either render path.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import path from 'path'

const exec = promisify(execFile)
const DEFAULT_FPS = 25
const OUT_W = 1080
const OUT_H = 1920
// Sources wider than 3:4 (e.g. 4:3 archival film, 16:9 stills) would need such
// an aggressive crop to fill 9:16 that the result reads as an unreadable
// extreme zoom — those get the "contained" letterbox treatment instead.
const CONTAIN_ASPECT = 3 / 4
// The contained foreground only ever zooms gently — it's meant to stay readable.
const CONTAIN_ZOOM_MAX = 1.08

/** ffprobe the source image's pixel size. Returns null on any failure
 *  (missing ffprobe, unreadable image) so callers can fall back to the
 *  legacy full-bleed path — never throws. */
async function probeImageSize(
  imagePath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0', imagePath],
      { timeout: 15_000 }
    )
    const [width, height] = stdout.trim().split(/[,\s]+/).map(Number)
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? { width, height }
      : null
  } catch {
    return null
  }
}

export interface KenBurnsOpts {
  /** Output mp4 path. Defaults to `<img-dir>/<img-basename>.kb.mp4`. */
  out?: string
  /** Frame rate. ffmpeg path uses 25; pass 30 to match Remotion. */
  fps?: number
  /** Max zoom factor over the clip (matches the legacy 1.18). */
  zoomMax?: number
}

/**
 * Render one still into a `dur`-second zoompan motion clip at 1080×1920.
 * Returns the output mp4 path on success, or '' if ffmpeg is missing/failed
 * (never throws — the caller decides how to degrade).
 */
export async function kenBurnsClip(
  imagePath: string,
  durationSec: number,
  opts: KenBurnsOpts = {}
): Promise<string> {
  const fps = opts.fps ?? DEFAULT_FPS
  const zoomMax = opts.zoomMax ?? 1.18
  const out =
    opts.out ??
    path.join(path.dirname(imagePath), `${path.basename(imagePath, path.extname(imagePath))}.kb.mp4`)
  const dur = Math.max(0.1, durationSec)
  const frames = Math.max(1, Math.round(dur * fps))

  // Wide/4:3 sources (archival film, landscape stills) get "contained":
  // a blurred, darkened, scaled-to-fill copy of the same image behind the
  // sharp image fit to full width and centred (classic shorts letterbox),
  // with only a gentle zoom on the foreground so it stays readable. Tall
  // sources keep the legacy full-bleed zoompan below. Probe failure → legacy.
  const size = await probeImageSize(imagePath)
  const contained = size !== null && size.width / size.height > CONTAIN_ASPECT
  let filterArgs: string[]
  if (contained && size) {
    const fgZoom = Math.min(zoomMax, CONTAIN_ZOOM_MAX)
    // Fit-width foreground height at output scale, rounded to an even value.
    const fgH = Math.max(2, 2 * Math.round((OUT_W * size.height) / size.width / 2))
    // Oversample 2× before zoompan so the gentle zoom has pixels to work with.
    const filter =
      `[0:v]split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},` +
      `gblur=sigma=24,eq=brightness=-0.2:saturation=0.8,fps=${fps}[bg];` +
      `[fgsrc]scale=${OUT_W * 2}:-2:flags=lanczos,` +
      `zoompan=z='min(zoom+0.0004,${fgZoom})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${fgH}:fps=${fps}[fg];` +
      `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1,format=yuv420p`
    filterArgs = ['-filter_complex', filter]
  } else {
    // Oversample 1.5× before the pan so the zoompan crop never reveals an edge.
    const scaleW = Math.round(OUT_W * 1.5)
    const scaleH = Math.round(OUT_H * 1.5)
    const vf =
      `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH},` +
      `zoompan=z='min(zoom+0.0012,${zoomMax})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${OUT_H}:fps=${fps},` +
      'setsar=1,format=yuv420p'
    filterArgs = ['-vf', vf]
  }
  try {
    await exec(
      'ffmpeg',
      ['-y', '-loop', '1', '-i', imagePath, '-t', String(dur), '-r', String(fps), ...filterArgs,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-an', out],
      { timeout: 300_000 }
    )
    return existsSync(out) ? out : ''
  } catch {
    return ''
  }
}

/**
 * Solid-colour fallback clip when no still is available. Returns the output
 * path on success or '' on failure. `hex` matches the legacy 0x111418 default.
 */
export async function solidColorClip(
  durationSec: number,
  opts: { out: string; fps?: number; hex?: string }
): Promise<string> {
  const fps = opts.fps ?? DEFAULT_FPS
  const hex = opts.hex ?? '0x111418'
  const dur = Math.max(0.1, durationSec)
  try {
    await exec(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=${OUT_W}x${OUT_H}:r=${fps}:d=${dur}`,
        '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', opts.out],
      { timeout: 120_000 }
    )
    return existsSync(opts.out) ? opts.out : ''
  } catch {
    return ''
  }
}
