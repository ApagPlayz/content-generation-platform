// Ken-Burns render helpers, extracted so both the slideshow assembler and any
// per-beat assembler animate stills through ONE code path. `kenBurnsClip`
// renders a single still into a slow zoompan motion clip; `solidColorClip` is
// the keyless lavfi fallback when there's no usable image. The ffmpeg args here
// are byte-for-byte equivalent to the inline renderImageClip/renderColorClip
// that used to live in assemble.ts (default fps 25, 1080×1920, crf 21/23), so
// swapping assemble.ts over to these is behaviour-preserving.
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
  // Oversample 1.5× before the pan so the zoompan crop never reveals an edge.
  const scaleW = Math.round(OUT_W * 1.5)
  const scaleH = Math.round(OUT_H * 1.5)
  const vf =
    `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH},` +
    `zoompan=z='min(zoom+0.0012,${zoomMax})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${OUT_H}:fps=${fps},` +
    'setsar=1,format=yuv420p'
  try {
    await exec(
      'ffmpeg',
      ['-y', '-loop', '1', '-i', imagePath, '-t', String(dur), '-r', String(fps), '-vf', vf,
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
