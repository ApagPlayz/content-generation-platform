import { NextResponse } from 'next/server'
import { authUrl } from '@/lib/youtube'

// Kicks off the OAuth consent flow. The Connect button links here.
export async function GET() {
  try {
    return NextResponse.redirect(await authUrl())
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth not configured'
    const base = process.env.APP_BASE_URL || 'http://localhost:3000'
    return NextResponse.redirect(`${base}/settings?youtube_error=${encodeURIComponent(msg)}`)
  }
}
