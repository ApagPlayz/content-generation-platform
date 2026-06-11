import { NextResponse } from 'next/server'
import { executeRun } from '@/lib/run'

// Kicks off a run and returns immediately; the pipeline (download + render)
// can take minutes. The UI polls /api/runs for status. Dispatches by factory
// type (F10 True Crime vs F9 sports) via executeRun.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  executeRun(id).catch((e) => {
    console.error(`Agent run failed for ${id}:`, e)
  })
  return NextResponse.json({ status: 'started' }, { status: 202 })
}
