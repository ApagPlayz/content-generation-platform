import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Content fields the review inbox is allowed to edit directly. Everything NOT on
// this list is silently dropped, so a raw request body can't mass-assign
// arbitrary Video columns (localPath, costActual, …). `status` is deliberately
// absent — it is handled separately through the validated transition table below,
// never as a pass-through, so `{"status":"approved"}` can't flip a rejected video.
const EDITABLE_FIELDS = ['title', 'description', 'hashtags'] as const

// Status changes permitted from THIS route (the manual review inbox). Keys are
// the current status; the array is the set it may move to.
//   - review → approved | draft | rejected : the reviewer approves, sends back
//     (the "Reject" button sets 'draft'), or hard-rejects.
//   - draft/approved → each other / review : reconsider before publishing.
// `rejected` (compliance hard-block), `published`, `failed`, `queued`,
// `publishing` are intentionally NOT keys: they are terminal here and can never
// be resurrected via PATCH — in particular there is no path back to 'approved'
// from 'rejected'.
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  review: ['approved', 'draft', 'rejected'],
  draft: ['approved', 'review'],
  approved: ['draft', 'review'],
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const input = body as Record<string, unknown>

  const data: Record<string, unknown> = {}

  // Allowlisted content edits (strings or null only).
  for (const key of EDITABLE_FIELDS) {
    if (key in input) {
      const value = input[key]
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json(
          { error: `Field "${key}" must be a string.` },
          { status: 400 }
        )
      }
      data[key] = value
    }
  }

  // Validated status transition — never a raw pass-through.
  if ('status' in input) {
    const next = input.status
    if (typeof next !== 'string') {
      return NextResponse.json({ error: 'status must be a string.' }, { status: 400 })
    }
    const current = await prisma.video.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
    }
    // Same-status PATCH is an idempotent no-op, not a rejected transition.
    if (next !== current.status) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[current.status] ?? []
      if (!allowed.includes(next)) {
        return NextResponse.json(
          {
            error: `Cannot change status from "${current.status}" to "${next}" via this route.`,
          },
          { status: 409 }
        )
      }
      data.status = next
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'No editable fields provided.' },
      { status: 400 }
    )
  }

  const video = await prisma.video.update({ where: { id }, data })
  return NextResponse.json(video)
}
