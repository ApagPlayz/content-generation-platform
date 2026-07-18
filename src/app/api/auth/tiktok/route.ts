import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { connectionState, PLATFORM } from '@/lib/tiktok'

// Connection status for the Settings UI. Three distinct states so a silently
// expired login (needs_reconnect) is never painted the same as a healthy one
// ("connected") or a never-set-up one ("none") — matching the YouTube route.
export async function GET() {
  const { state, handle } = await connectionState()
  return NextResponse.json({ connected: state === 'active', state, handle: handle ?? null })
}

// Disconnect — drops the stored tokens.
export async function DELETE() {
  await prisma.platformAuth.updateMany({
    where: { platform: PLATFORM },
    data: { status: 'revoked' },
  })
  return NextResponse.json({ ok: true })
}
