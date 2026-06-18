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

import { createReadStream, existsSync, statSync } from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import type { AssembleResult, MomentResult, ScriptResult } from '../tools/types'

const FPS = 30

/** True when the operator has opted into the Remotion render engine. */
export function isRemotionEnabled(): boolean {
  return (process.env.RENDER_ENGINE || '').trim().toLowerCase() === 'remotion'
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
        res.setHeader('Content-Type', 'video/mp4')

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
