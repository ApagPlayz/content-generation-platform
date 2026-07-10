import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeNextRun } from '@/lib/scheduler'

const CADENCES = ['hourly', 'daily', 'weekly']

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: {
    enabled?: boolean
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

  const existing = await prisma.schedule.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'schedule not found' }, { status: 404 })
  }

  if (body.cadence !== undefined && !CADENCES.includes(body.cadence)) {
    return NextResponse.json({ error: 'cadence must be hourly, daily, or weekly' }, { status: 400 })
  }

  const data: {
    enabled?: boolean
    cadence?: string
    hourUTC?: number | null
    minuteUTC?: number
    dayOfWeek?: number | null
    nextRunAt?: Date | null
  } = {}

  if (body.enabled !== undefined) data.enabled = body.enabled
  if (body.cadence !== undefined) data.cadence = body.cadence
  if (body.hourUTC !== undefined) data.hourUTC = body.hourUTC === null ? null : Number(body.hourUTC)
  if (body.minuteUTC !== undefined) data.minuteUTC = Number(body.minuteUTC)
  if (body.dayOfWeek !== undefined)
    data.dayOfWeek = body.dayOfWeek === null ? null : Number(body.dayOfWeek)

  // Recompute nextRunAt if timing changed or the schedule is (re)enabled.
  const timingChanged =
    body.cadence !== undefined ||
    body.hourUTC !== undefined ||
    body.minuteUTC !== undefined ||
    body.dayOfWeek !== undefined
  const reEnabled = body.enabled === true && !existing.enabled
  const willBeEnabled = data.enabled ?? existing.enabled

  if (willBeEnabled && (timingChanged || reEnabled || existing.nextRunAt === null)) {
    data.nextRunAt = computeNextRun({
      cadence: data.cadence ?? existing.cadence,
      hourUTC: data.hourUTC ?? existing.hourUTC,
      minuteUTC: data.minuteUTC ?? existing.minuteUTC,
      dayOfWeek: data.dayOfWeek ?? existing.dayOfWeek,
    })
  }
  if (data.enabled === false) {
    data.nextRunAt = null
  }

  const schedule = await prisma.schedule.update({
    where: { id },
    data,
    include: { agent: { select: { name: true, factory: { select: { type: true } } } } },
  })

  return NextResponse.json(schedule)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.schedule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
