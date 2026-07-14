import { NextResponse } from 'next/server'
import { authUrl } from '@/lib/tiktok'

// Kicks off the OAuth consent flow. The Connect button links here.
export async function GET() {
  try {
    return NextResponse.redirect(await authUrl())
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'TikTok not configured'
    const base = process.env.APP_BASE_URL || 'http://localhost:3000'
    return NextResponse.redirect(`${base}/settings?tiktok_error=${encodeURIComponent(msg)}`)
  }
}
