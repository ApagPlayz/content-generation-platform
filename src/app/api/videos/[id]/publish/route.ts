import { NextResponse } from 'next/server'
import { publishToYouTube } from '@/lib/tools/publish'

// Publishes a rendered video to YouTube. Fired from the review inbox.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await publishToYouTube(id)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Publish failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
