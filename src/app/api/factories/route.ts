import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const factories = await prisma.factory.findMany({
    where: { archived: false },
    include: { _count: { select: { videos: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(factories)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { name, type, description, autonomy = 'review' } = body

  if (!name || !type) {
    return NextResponse.json({ error: 'name and type are required' }, { status: 400 })
  }

  const factory = await prisma.factory.create({
    data: {
      name,
      type,
      config: JSON.stringify({ description: description || '', pipeline: type }),
      postingDefaults: JSON.stringify({ autonomy }),
    },
  })

  return NextResponse.json(factory, { status: 201 })
}
