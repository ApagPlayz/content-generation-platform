// Integration tests for the media streaming route. These prove the actual
// end-to-end wiring that makes the review-inbox preview play on Safari/iOS:
// a Range request must come back as a 206 with the correct byte slice, the
// right Content-Range/Content-Length, and Accept-Ranges. Prisma is mocked; the
// handler reads a real temp file so the streaming path is genuinely exercised.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('@/lib/prisma', () => ({
  prisma: { video: { findUnique: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { GET } from './route'

let dir: string
let file: string
const body = Buffer.from('0123456789') // 10 bytes → offsets 0..9

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'media-'))
  file = join(dir, 'v.mp4')
  writeFileSync(file, body)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function call(headers: Record<string, string> = {}, localPath: string = file) {
  vi.mocked(prisma.video.findUnique).mockResolvedValue({ id: 'v1', localPath } as never)
  return GET(new Request('http://localhost/api/media/v1', { headers }), {
    params: Promise.resolve({ videoId: 'v1' }),
  })
}

describe('GET /api/media/[videoId]', () => {
  it('serves the whole file as 200 and advertises Accept-Ranges when no Range is sent', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('10')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body)
  })

  it('answers a Range request with a 206 and exactly the requested byte slice', async () => {
    const res = await call({ range: 'bytes=2-5' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe('2345')
  })

  it('handles the open-ended "bytes=0-" request Safari opens playback with', async () => {
    const res = await call({ range: 'bytes=0-' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-9/10')
    expect(res.headers.get('content-length')).toBe('10')
    expect(await res.text()).toBe('0123456789')
  })

  it('returns 416 with Content-Range for an unsatisfiable range', async () => {
    const res = await call({ range: 'bytes=100-200' })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })

  it('404s when the file is missing on disk', async () => {
    const res = await call({}, join(dir, 'nope.mp4'))
    expect(res.status).toBe(404)
  })
})
