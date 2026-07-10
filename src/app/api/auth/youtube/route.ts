import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { connection, PLATFORM } from '@/lib/youtube'

// Connection status for the Settings UI.
export async function GET() {
  const conn = await connection()
  return NextResponse.json(
    conn
      ? { connected: true, handle: conn.accountHandle, connectedAt: conn.updatedAt }
      : { connected: false }
  )
}

// Disconnect — drops the stored tokens.
export async function DELETE() {
  await prisma.platformAuth.updateMany({
    where: { platform: PLATFORM },
    data: { status: 'revoked' },
  })
  return NextResponse.json({ ok: true })
}
