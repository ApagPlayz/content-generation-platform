import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const runs = await prisma.agentRun.findMany({
    include: { agent: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  })
  return NextResponse.json(runs)
}
