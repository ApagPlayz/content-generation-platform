import { NextResponse } from 'next/server'
import { exchangeAndStore } from '@/lib/tiktok'

// TikTok redirects here with ?code=... — exchange it, store tokens, bounce to Settings.
export async function GET(req: Request) {
  const base = process.env.APP_BASE_URL || 'http://localhost:3000'
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error') || url.searchParams.get('error_description')

  if (error) {
    return NextResponse.redirect(`${base}/settings?tiktok_error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${base}/settings?tiktok_error=missing_code`)
  }

  try {
    const { handle } = await exchangeAndStore(code)
    return NextResponse.redirect(`${base}/settings?tiktok_connected=${encodeURIComponent(handle)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'token_exchange_failed'
    return NextResponse.redirect(`${base}/settings?tiktok_error=${encodeURIComponent(msg)}`)
  }
}
