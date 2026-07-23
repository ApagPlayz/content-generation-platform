// Focused tests for the `archiveStillsOnly` flag (visual-quality fix): when set,
// the archive.org search must narrow to `mediatype:image` (real photographs) so
// no film reels are searched and no motion-blurred poster-frames are grabbed.
// Covers the query-string build (archiveSearch) and the propagation path
// through the per-video pool (ArchiveStillPool → gatherArchiveDocs → search).

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArchiveStillPool,
  archiveSearch,
  clipInPoint,
  gatherArchiveDocs,
  pickBestVideoDerivative,
  MIN_CLIP_HEIGHT,
  type ArchiveDoc,
  type ArchiveFile,
  type ArchivePoolDeps,
} from './archiveFootage'

// Stub global fetch: capture the requested URL and return an empty-but-ok
// archive.org search payload. archiveSearch passes no fetchImpl, so budget.ts
// falls through to global fetch — this is the least-invasive seam.
function stubFetch(): { urls: string[] } {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      return {
        ok: true,
        json: async () => ({ response: { docs: [] } }),
      } as unknown as Response
    })
  )
  return { urls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('archiveSearch mediatype clause', () => {
  it('defaults to movies OR image (unchanged behaviour)', async () => {
    const { urls } = stubFetch()
    await archiveSearch('bank robbery', ['prelinger'], 5)
    const decoded = decodeURIComponent(urls[0])
    expect(decoded).toContain('mediatype:(movies OR image)')
    expect(decoded).not.toContain('mediatype:image AND')
  })

  it('narrows to mediatype:image when stillsOnly is true', async () => {
    const { urls } = stubFetch()
    await archiveSearch('bank robbery', ['prelinger'], 5, true)
    const decoded = decodeURIComponent(urls[0])
    expect(decoded).toContain('mediatype:image')
    expect(decoded).not.toContain('movies OR image')
  })

  it('stillsOnly=false is explicit no-op (same as default)', async () => {
    const { urls } = stubFetch()
    await archiveSearch('bank robbery', ['prelinger'], 5, false)
    expect(decodeURIComponent(urls[0])).toContain('mediatype:(movies OR image)')
  })
})

describe('pickBestVideoDerivative', () => {
  const file = (name: string, over: Partial<ArchiveFile> = {}): ArchiveFile => ({ name, ...over })

  it('picks the tallest derivative that clears the height floor', () => {
    const meta = {
      files: [
        file('reel_512kb.mp4', { height: '240', size: '1000' }),
        file('reel.mp4', { height: '720', size: '5000' }),
        file('reel_hd.mp4', { height: '1080', size: '9000' }),
      ],
    }
    expect(pickBestVideoDerivative(meta, MIN_CLIP_HEIGHT)?.name).toBe('reel_hd.mp4')
  })

  it('falls back to the LARGEST unknown-height file when none reports a clearing height', () => {
    const meta = {
      files: [
        file('reel_a.mp4', { size: '3000' }), // no height reported
        file('reel_b.mp4', { size: '8000' }),
      ],
    }
    expect(pickBestVideoDerivative(meta)?.name).toBe('reel_b.mp4')
  })

  it('rejects an item whose every derivative is a KNOWN-tiny transcode', () => {
    const meta = {
      files: [file('tiny.mp4', { height: '180', size: '900' }), file('tinier.mp4', { height: '144', size: '500' })],
    }
    expect(pickBestVideoDerivative(meta, MIN_CLIP_HEIGHT)).toBeNull()
  })

  it('ignores thumbnails and non-mp4 files', () => {
    const meta = {
      files: [
        file('reel__ia_thumb.jpg'),
        file('reel_thumb.mp4', { height: '720' }),
        file('reel.ogv', { height: '720' }),
        file('reel.mp4', { height: '480', size: '4000' }),
      ],
    }
    // Only reel.mp4 is a real, non-thumbnail mp4.
    expect(pickBestVideoDerivative(meta, MIN_CLIP_HEIGHT)?.name).toBe('reel.mp4')
  })

  it('returns null when the item has no video derivatives at all', () => {
    expect(pickBestVideoDerivative({ files: [{ name: 'photo.jpg' }] }, MIN_CLIP_HEIGHT)).toBeNull()
  })
})

describe('clipInPoint', () => {
  it('seeks ~25% into a known-duration reel to skip title cards', () => {
    expect(clipInPoint(200, 8)).toBeCloseTo(50, 5) // 200 * 0.25
  })

  it('clamps the in-point so the whole clip window stays inside the reel', () => {
    // A 60s reel, 8s clip: 25% is 15s, and 15 + 8 ≤ 60 — the window fits.
    const p = clipInPoint(60, 8)
    expect(p).toBeCloseTo(15, 5)
    expect(p + 8).toBeLessThanOrEqual(60)
    // A tighter reel is clamped back so the window never runs off the end.
    const q = clipInPoint(40, 8)
    expect(q + 8).toBeLessThanOrEqual(40)
  })

  it('falls back to a fixed post-titles offset when the duration is unknown', () => {
    expect(clipInPoint(null, 8)).toBeGreaterThan(0)
  })
})

describe('archiveStillsOnly propagation', () => {
  it('gatherArchiveDocs forwards stillsOnly to the search function', async () => {
    const seen: boolean[] = []
    const search: ArchivePoolDeps['search'] = async (_q, _c, _rows, stillsOnly) => {
      seen.push(stillsOnly ?? false)
      return []
    }
    await gatherArchiveDocs(['topic 1963'], { need: 3, rows: 5, stillsOnly: true }, search)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((v) => v === true)).toBe(true)
  })

  it('gatherArchiveDocs defaults stillsOnly to false when omitted', async () => {
    const seen: boolean[] = []
    const search: ArchivePoolDeps['search'] = async (_q, _c, _rows, stillsOnly) => {
      seen.push(stillsOnly ?? false)
      return []
    }
    await gatherArchiveDocs(['topic 1963'], { need: 3, rows: 5 }, search)
    expect(seen.every((v) => v === false)).toBe(true)
  })

  it('ArchiveStillPool threads stillsOnly from its options into the search', async () => {
    const seen: boolean[] = []
    const docs: ArchiveDoc[] = [{ identifier: 'photo-1', mediatype: 'image' }]
    const deps: ArchivePoolDeps = {
      search: async (_q, _c, _rows, stillsOnly) => {
        seen.push(stillsOnly ?? false)
        return docs
      },
      resolve: async () => null, // resolution is out of scope here
    }
    const pool = new ArchiveStillPool(['topic 1963'], { beatCount: 2, stillsOnly: true }, deps)
    await pool.acquireStill(0)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((v) => v === true)).toBe(true)
  })
})
