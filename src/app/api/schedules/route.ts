import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeNextRun } from '@/lib/scheduler'

export async function GET() {
  const schedules = await prisma.schedule.findMany({
    include: { agent: { select: { name: true, factory: { select: { type: true } } } } },
    orderBy: { nextRunAt: 'asc' },
  })
  return NextResponse.json(schedules)
}

const CADENCES = ['hourly', 'daily', 'weekly']

export async function POST(req: Request) {
  let body: {
    agentId?: string
    cadence?: string
    hourUTC?: number | null
    minuteUTC?: number
    dayOfWeek?: number | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { agentId } = body
  const cadence = body.cadence ?? 'daily'

  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
  }
  if (!CADENCES.includes(cadence)) {
    return NextResponse.json({ error: 'cadence must be hourly, daily, or weekly' }, { status: 400 })
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 400 })
  }

  const hourUTC =
    body.hourUTC === null || body.hourUTC === undefined ? null : Number(body.hourUTC)
  const minuteUTC = body.minuteUTC === undefined ? 0 : Number(body.minuteUTC)
  const dayOfWeek =
    body.dayOfWeek === null || body.dayOfWeek === undefined ? null : Number(body.dayOfWeek)

  if (hourUTC !== null && (hourUTC < 0 || hourUTC > 23)) {
    return NextResponse.json({ error: 'hourUTC must be 0-23' }, { status: 400 })
  }
  if (minuteUTC < 0 || minuteUTC > 59) {
    return NextResponse.json({ error: 'minuteUTC must be 0-59' }, { status: 400 })
  }
  if (dayOfWeek !== null && (dayOfWeek < 0 || dayOfWeek > 6)) {
    return NextResponse.json({ error: 'dayOfWeek must be 0-6' }, { status: 400 })
  }

  const nextRunAt = computeNextRun({ cadence, hourUTC, minuteUTC, dayOfWeek })

  const schedule = await prisma.schedule.create({
    data: { agentId, cadence, hourUTC, minuteUTC, dayOfWeek, nextRunAt },
    include: { agent: { select: { name: true, factory: { select: { type: true } } } } },
  })

  return NextResponse.json(schedule, { status: 201 })
}
