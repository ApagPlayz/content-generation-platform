import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const agents = await prisma.agent.findMany({
    include: {
      factory: { select: { id: true, name: true, type: true } },
      _count: { select: { runs: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(agents)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { factoryId, name, playbook, autonomy = 'review', budget } = body

  if (!factoryId || !name || !playbook) {
    return NextResponse.json(
      { error: 'factoryId, name, and playbook are required' },
      { status: 400 }
    )
  }

  const agent = await prisma.agent.create({
    data: { factoryId, name, playbook, autonomy, budget: budget ? parseFloat(budget) : null },
  })
  return NextResponse.json(agent, { status: 201 })
}
