// Focused tests for the `archiveStillsOnly` flag (visual-quality fix): when set,
// the archive.org search must narrow to `mediatype:image` (real photographs) so
// no film reels are searched and no motion-blurred poster-frames are grabbed.
// Covers the query-string build (archiveSearch) and the propagation path
// through the per-video pool (ArchiveStillPool → gatherArchiveDocs → search).

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArchiveStillPool,
  archiveSearch,
  gatherArchiveDocs,
  type ArchiveDoc,
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
