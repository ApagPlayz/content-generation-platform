import { prisma } from '@/lib/prisma'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'

// Streams the rendered MP4 for local preview in the review inbox.
export async function GET(_req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video?.localPath || !existsSync(video.localPath)) {
    return new Response('Not found', { status: 404 })
  }
  const { size } = statSync(video.localPath)
  const stream = Readable.toWeb(createReadStream(video.localPath)) as ReadableStream
  return new Response(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
    },
  })
}
