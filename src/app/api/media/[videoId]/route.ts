import { prisma } from '@/lib/prisma'
import { TIKTOK_CUT_ASSET_KIND } from '@/lib/tools/longCut'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'

// Streams the rendered MP4 for local preview in the review inbox.
//
// `?cut=tiktok` streams the longer TikTok-only render instead (issue #77), so
// the owner can watch the exact file TikTok will receive before approving.
// Falls back to the short cut whenever that render doesn't exist.
export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const video = await prisma.video.findUnique({ where: { id: videoId } })

  let filePath = video?.localPath ?? null
  if (new URL(req.url).searchParams.get('cut') === 'tiktok') {
    const asset = await prisma.asset.findFirst({
      where: { videoId, kind: TIKTOK_CUT_ASSET_KIND },
      orderBy: { createdAt: 'desc' },
      select: { localPath: true },
    })
    if (asset?.localPath) filePath = asset.localPath
  }

  if (!filePath || !existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }
  const { size } = statSync(filePath)
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
  return new Response(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
    },
  })
}
