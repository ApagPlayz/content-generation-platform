import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { gateVideoScript } from '@/lib/compliance'
import type { TrueCrimeScript } from '@/lib/compliance'

// POST /api/compliance — run the F10 fact-checking + compliance gate on a script.
// Body: { script: TrueCrimeScript, videoId?: string }
// Returns the persisted ComplianceReport + decision (pass | route_to_review | block).
export async function POST(req: Request) {
  let body: { script?: TrueCrimeScript; videoId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const script = body.script
  if (!script || !script.caseName || !script.narration || !Array.isArray(script.subjects)) {
    return NextResponse.json(
      { error: 'Body must include script.{caseName, narration, subjects[]}' },
      { status: 400 }
    )
  }

  const { report, reportId } = await gateVideoScript(script, {
    videoId: body.videoId,
    generatedAt: new Date().toISOString(),
  })

  return NextResponse.json({ reportId, ...report })
}

// GET /api/compliance — recent compliance reports (for the F10 review inbox).
export async function GET() {
  const reports = await prisma.complianceReport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      videoId: true,
      caseName: true,
      decision: true,
      caseSelectionOk: true,
      corroboratedPct: true,
      defamationFlags: true,
      variationOk: true,
      summary: true,
      createdAt: true,
    },
  })
  return NextResponse.json(reports)
}
