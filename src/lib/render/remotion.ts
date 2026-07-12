// Remotion server-side render path for the F9 sports factory. Opt-in via
// RENDER_ENGINE=remotion; runAssemble falls back to ffmpeg if this throws.
//
// Remotion's asset pipeline only accepts http(s):// (it explicitly rejects
// file://), so we serve the source reel's directory over an ephemeral
// localhost server for the duration of the render and hand the composition an
// http URL. The webpack bundle is built once per process and reused across
// renders (bundle() is an anti-pattern to call per video).
//
// All @remotion/* imports are dynamic so this module — and the native
// binaries it pulls in (headless Chromium, esbuild) — never load unless the
// flag is set and a render actually runs.

import { execFile } from 'child_process'
import { createReadStream, existsSync, statSync } from 'fs'
import http from 'http'
import path from 'path'
import { promisify } from 'util'
import type { AddressInfo } from 'net'
import type { AssembleResult, MomentResult, ScriptResult } from '../tools/types'
import type { CaptionsResult, RenderResult, ScriptBeat } from '../truecrime/types'
import { buildBeatTimeline, toCumulativeFrames } from '../truecrime/timeline'

const FPS = 30

const exec = promisify(execFile)

/** True when the operator has opted into the Remotion render engine. */
export function isRemotionEnabled(): boolean {
  return (process.env.RENDER_ENGINE || '').trim().toLowerCase() === 'remotion'
}

/** True when a media file's first video frame decodes cleanly. Catches the
 *  corrupt/truncated downloads (e.g. a bad archive.org thumbnail) that make
 *  Chromium throw EncodingError inside <Img> and cancel the whole render.
 *  ffmpeg's decoders conceal damage Chromium refuses (a truncated JPEG exits 0
 *  with an error-level "overread" log), so any `-v error` output counts as a
 *  failure too — dropping a borderline asset is the safe direction here. */
async function isDecodable(filePath: string): Promise<boolean> {
  try {
    const { stderr } = await exec(
      'ffmpeg',
      ['-v', 'error', '-xerror', '-i', filePath, '-frames:v', '1', '-f', 'null', '-'],
      { timeout: 30_000 }
    )
    return stderr.trim() === ''
  } catch {
    return false
  }
}

/** Drop inputs that fail the decode probe, warning per dropped asset. Fails
 *  open (returns the list unchanged) when ffmpeg isn't on PATH so validation
 *  can never block a render on its own. */
async function filterDecodable(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return paths
  try {
    await exec('which', ['ffmpeg'])
  } catch {
    return paths
  }
  const checks = await Promise.all(paths.map((p) => isDecodable(p)))
  paths.forEach((p, i) => {
    if (!checks[i]) console.warn('[render/remotion] dropping undecodable asset:', p)
  })
  return paths.filter((_, i) => checks[i])
}

// Cache the bundle promise across renders in this process.
let bundlePromise: Promise<string> | null = null

async function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import('@remotion/bundler')
      return bundle({
        entryPoint: path.join(process.cwd(), 'video', 'index.ts'),
        // No webpack overrides — the compositions are plain React.
        webpackOverride: (config) => config,
      })
    })().catch((err) => {
      // Don't cache a failed bundle — let the next render retry.
      bundlePromise = null
      throw err
    })
  }
  return bundlePromise
}

/** Minimal extension → MIME map for the loopback asset server (mp4 reels for
 *  sports, jpg stills + wav narration for true crime). */
function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    default:
      return 'application/octet-stream'
  }
}

interface FileServer {
  /** Base URL, e.g. http://127.0.0.1:54123 */
  baseUrl: string
  close: () => void
}

/**
 * Serve a single directory over loopback with HTTP range support (Chromium
 * issues range requests when fetching media). Binds to an ephemeral port so
 * concurrent renders never collide.
 */
function serveDirectory(dir: string): Promise<FileServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
        const filePath = path.join(dir, name)
        // Refuse path traversal outside the served directory.
        if (filePath !== dir && !filePath.startsWith(dir + path.sep)) {
          res.statusCode = 403
          res.end()
          return
        }
        const stat = statSync(filePath)
        const range = req.headers.range
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', contentType(filePath))

        if (range) {
          const match = /bytes=(\d*)-(\d*)/.exec(range)
          const start = match && match[1] ? parseInt(match[1], 10) : 0
          const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          res.setHeader('Content-Length', end - start + 1)
          createReadStream(filePath, { start, end }).pipe(res)
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Length', stat.size)
        createReadStream(filePath).pipe(res)
      } catch {
        res.statusCode = 404
        res.end()
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      })
    })
  })
}

/**
 * Render the detected moment as a 9:16 highlight with an animated hook caption.
 * Mirrors runAssemble's contract so it can be dropped in behind the flag.
 */
export async function renderSportsHighlight(
  sourcePath: string,
  moment: MomentResult,
  script: ScriptResult
): Promise<AssembleResult> {
  const dir = path.dirname(sourcePath)
  const outputPath = path.join(dir, 'final.mp4')
  const durationSec = moment.endSec - moment.startSec

  const { renderMedia, selectComposition } = await import('@remotion/renderer')
  const serveUrl = await getServeUrl()
  const fileServer = await serveDirectory(dir)

  try {
    const videoSrc = `${fileServer.baseUrl}/${encodeURIComponent(path.basename(sourcePath))}`
    const inputProps = {
      videoSrc,
      startSec: moment.startSec,
      endSec: moment.endSec,
      hook: script.hook,
      fps: FPS,
    }

    const composition = await selectComposition({
      serveUrl,
      id: 'SportsHighlight',
      inputProps,
    })

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
    })
  } finally {
    fileServer.close()
  }

  if (!existsSync(outputPath)) {
    throw new Error('Remotion finished but final.mp4 not found')
  }
  return { outputPath, durationSec }
}

/**
 * Render the F10 True Crime piece: a Ken-Burns slideshow over the sourced
 * stills with word-by-word (karaoke) captions driven by the caption cues.
 * Mirrors assembleVideo's contract so assemble.ts can drop it in behind the
 * RENDER_ENGINE=remotion flag and fall back to ffmpeg on any failure.
 *
 * Images and audio share one directory (media/<videoId>/), so a single
 * loopback server covers every asset; props reference them by basename URL.
 */
export async function renderTrueCrime(
  imagePaths: string[],
  audioPath: string,
  durationSec: number,
  captions: CaptionsResult,
  opts?: { beats?: ScriptBeat[]; beatFootage?: Record<number, string[]> }
): Promise<RenderResult> {
  const dir = path.dirname(audioPath)
  const outputPath = path.join(dir, 'final.mp4')

  // Pre-validate every visual input: a single undecodable image/clip makes
  // Chromium abort the whole Remotion render, so drop bad assets up front —
  // the timeline below simply redistributes across the survivors.
  const usableImages = await filterDecodable(imagePaths)
  let beatFootage = opts?.beatFootage
  if (beatFootage && Object.keys(beatFootage).length > 0) {
    const checked = await Promise.all(
      Object.entries(beatFootage).map(
        async ([idx, clips]) => [idx, await filterDecodable(clips)] as const
      )
    )
    beatFootage = Object.fromEntries(checked.filter(([, clips]) => clips.length > 0))
  }

  const { renderMedia, selectComposition } = await import('@remotion/renderer')
  const serveUrl = await getServeUrl()
  const fileServer = await serveDirectory(dir)

  try {
    const url = (p: string) => `${fileServer.baseUrl}/${encodeURIComponent(path.basename(p))}`

    // Per-beat stitched timeline (mixed video clips + Ken-Burns stills). Uses
    // the SAME seconds-based timeline as the ffmpeg path, converted to this
    // engine's 30fps grid on the running cumulative total to avoid cut drift.
    // Empty → the composition falls back to the even imageSrcs slideshow.
    let beatClips: {
      src: string
      kind: 'video' | 'image'
      startFrame: number
      durationInFrames: number
      inSec: number
    }[] = []
    if (opts?.beats && opts.beats.length > 0 && beatFootage && Object.keys(beatFootage).length > 0) {
      const segments = buildBeatTimeline(opts.beats, beatFootage, durationSec)
      const spans = toCumulativeFrames(segments, FPS)
      beatClips = segments.map((seg, i) => ({
        src: url(seg.assetPath),
        kind: seg.kind,
        startFrame: spans[i].startFrame,
        durationInFrames: spans[i].durationInFrames,
        inSec: seg.inSec ?? 0,
      }))
    }

    const inputProps = {
      imageSrcs: usableImages.map(url),
      audioSrc: url(audioPath),
      durationSec,
      cues: captions.cues,
      fps: FPS,
      beatClips,
    }

    const composition = await selectComposition({
      serveUrl,
      id: 'TrueCrime',
      inputProps,
    })

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
    })
  } finally {
    fileServer.close()
  }

  if (!existsSync(outputPath)) {
    throw new Error('Remotion finished but final.mp4 not found')
  }
  return { outputPath, durationSec, rendered: true }
}
