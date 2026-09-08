import { NextResponse } from 'next/server'
import { authUrl } from '@/lib/meta'

// Kicks off the OAuth consent flow. The Connect button links here.
export async function GET() {
  try {
    return NextResponse.redirect(await authUrl())
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Facebook not configured'
    const base = process.env.APP_BASE_URL || 'http://localhost:3000'
    return NextResponse.redirect(`${base}/settings?facebook_error=${encodeURIComponent(msg)}`)
  }
}
