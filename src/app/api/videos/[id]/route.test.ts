import { beforeEach, describe, expect, it, vi } from 'vitest'

// The video PATCH route is reachable from the review inbox. These tests lock the
// safety fixes: (1) `status` is validated against a transition table so a raw
// `{"status":"approved"}` can never resurrect a compliance-'rejected' video; and
// (2) only allowlisted content fields are writable — arbitrary columns are dropped.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    video: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { PATCH } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/videos/v1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: 'v1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.video.update).mockResolvedValue({ id: 'v1' } as never)
})

describe('PATCH /api/videos/[id] status transitions', () => {
  it('BLOCKS rejected → approved (the core exploit) with a 409 and no DB write', async () => {
    vi.mocked(prisma.video.findUnique).mockResolvedValue({ status: 'rejected' } as never)

    const res = await PATCH(req({ status: 'approved' }), { params })

    expect(res.status).toBe(409)
    expect(prisma.video.update).not.toHaveBeenCalled()
  })

  it('allows the reviewer approve: review → approved', async () => {
    vi.mocked(prisma.video.findUnique).mockResolvedValue({ status: 'review' } as never)

    const res = await PATCH(req({ status: 'approved' }), { params })

    expect(res.status).toBe(200)
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'approved' },
    })
  })

  it('allows the reviewer reject: review → draft (the UI "Reject" button)', async () => {
    vi.mocked(prisma.video.findUnique).mockResolvedValue({ status: 'review' } as never)

    const res = await PATCH(req({ status: 'draft' }), { params })

    expect(res.status).toBe(200)
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'draft' },
    })
  })

  it.each(['published', 'failed', 'queued'])(
    'refuses to move a terminal "%s" video to approved',
    async (status) => {
      vi.mocked(prisma.video.findUnique).mockResolvedValue({ status } as never)
      const res = await PATCH(req({ status: 'approved' }), { params })
      expect(res.status).toBe(409)
      expect(prisma.video.update).not.toHaveBeenCalled()
    }
  )

  it('treats a same-status PATCH as an idempotent no-op (not a rejected transition)', async () => {
    vi.mocked(prisma.video.findUnique).mockResolvedValue({ status: 'rejected' } as never)
    // status equals current → dropped from the update; nothing else provided → 400.
    const res = await PATCH(req({ status: 'rejected' }), { params })
    expect(res.status).toBe(400)
    expect(prisma.video.update).not.toHaveBeenCalled()
  })

  it('404s when the video does not exist', async () => {
    vi.mocked(prisma.video.findUnique).mockResolvedValue(null as never)
    const res = await PATCH(req({ status: 'approved' }), { params })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/videos/[id] field allowlist', () => {
  it('writes allowlisted content fields (title/description/hashtags)', async () => {
    const res = await PATCH(
      req({ title: 'New title', description: 'New desc', hashtags: '["a"]' }),
      { params }
    )
    expect(res.status).toBe(200)
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { title: 'New title', description: 'New desc', hashtags: '["a"]' },
    })
  })

  it('drops non-allowlisted fields (mass-assignment defence)', async () => {
    const res = await PATCH(
      req({ title: 'ok', localPath: '/etc/passwd', costActual: 999, id: 'hijack' }),
      { params }
    )
    expect(res.status).toBe(200)
    // Only `title` survives; localPath/costActual/id are never forwarded to Prisma.
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { title: 'ok' },
    })
  })

  it('rejects a non-string content field', async () => {
    const res = await PATCH(req({ title: 123 }), { params })
    expect(res.status).toBe(400)
    expect(prisma.video.update).not.toHaveBeenCalled()
  })

  it('400s when no editable fields are provided', async () => {
    const res = await PATCH(req({ foo: 'bar' }), { params })
    expect(res.status).toBe(400)
    expect(prisma.video.update).not.toHaveBeenCalled()
  })
})
