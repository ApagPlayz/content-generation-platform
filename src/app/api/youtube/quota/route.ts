import { NextResponse } from 'next/server'
import { quotaStatus } from '@/lib/tools/publish'

// Remaining YouTube uploads today — drives the cockpit + settings quota meter.
export async function GET() {
  return NextResponse.json(await quotaStatus())
}
