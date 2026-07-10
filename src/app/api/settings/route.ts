import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const settings = await prisma.setting.findMany()
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  return NextResponse.json(map)
}

export async function PUT(req: Request) {
  const body: Record<string, string> = await req.json()
  await Promise.all(
    Object.entries(body).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  )
  return NextResponse.json({ ok: true })
}
