import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const factory = await prisma.factory.update({ where: { id }, data: body })
  return NextResponse.json(factory)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.factory.update({ where: { id }, data: { archived: true } })
  return NextResponse.json({ ok: true })
}
