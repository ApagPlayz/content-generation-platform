import { prisma } from '@/lib/prisma'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'
import { parseRange } from '@/lib/http-range'

// fs streaming requires the Node.js runtime (not Edge). Pin it explicitly so a
// future global runtime change can't silently break this route.
export const runtime = 'nodejs'
// The response depends on DB state + the request's Range header; never cache it.
export const dynamic = 'force-dynamic'

// Streams the rendered MP4 for local preview in the review inbox.
// Honors HTTP Range so Safari/iOS <video> can play and scrub the preview (they
// require a 206 byte-range response and refuse a full-body 200 to a Range request).
export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video?.localPath || !existsSync(video.localPath)) {
    return new Response('Not found', { status: 404 })
  }

  const { size } = statSync(video.localPath)
  const parsed = parseRange(req.headers.get('range'), size)

  // 416: a valid range we can't meet — tell the client the current length.
  if (parsed === 'unsatisfiable') {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    })
  }

  // 200: no (usable) Range header — advertise that we accept ranges so the
  // browser will send one next and enable seeking.
  if (parsed === 'full') {
    const stream = Readable.toWeb(createReadStream(video.localPath)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  }

  // 206: partial content. createReadStream's `end` is inclusive, matching the
  // inclusive offsets from parseRange and the Content-Range header — no off-by-one.
  const { start, end } = parsed
  const stream = Readable.toWeb(
    createReadStream(video.localPath, { start, end }),
  ) as ReadableStream
  return new Response(stream, {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  })
}
