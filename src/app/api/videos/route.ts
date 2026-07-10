import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const videos = await prisma.video.findMany({
    where: status ? { status } : undefined,
    include: {
      factory: { select: { name: true, type: true } },
      highlightSources: true,
      jobs: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(videos)
}
