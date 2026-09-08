// Unit tests for parseRange() — RFC 7233 byte-range parsing that lets Safari/iOS
// play the media preview (they need 206 partial responses). Pure function, so no
// mocks: every branch is exercised directly against a fixed entity size.
import { describe, expect, it } from 'vitest'
import { parseRange } from './http-range'

const SIZE = 1000 // pretend the MP4 is 1000 bytes → valid offsets 0..999

describe('parseRange — no/ignored header → full', () => {
  it('returns full when header is null', () => {
    expect(parseRange(null, SIZE)).toBe('full')
  })
  it('ignores a non-bytes unit', () => {
    expect(parseRange('items=0-10', SIZE)).toBe('full')
  })
  it('ignores multipart (comma) ranges', () => {
    expect(parseRange('bytes=0-99,200-299', SIZE)).toBe('full')
  })
  it('ignores garbage', () => {
    expect(parseRange('bytes=abc', SIZE)).toBe('full')
    expect(parseRange('bytes=', SIZE)).toBe('full')
    expect(parseRange('bytes=-', SIZE)).toBe('full')
    expect(parseRange('bytes=10.5-20', SIZE)).toBe('full')
    expect(parseRange('bytes=-1e3', SIZE)).toBe('full')
  })
  it('ignores an inverted range (end < start)', () => {
    expect(parseRange('bytes=500-100', SIZE)).toBe('full')
  })
})

describe('parseRange — open-ended "bytes=start-"', () => {
  it('bytes=0- → whole file (the request Safari opens with)', () => {
    expect(parseRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 })
  })
  it('bytes=500- → tail from 500', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })
})

describe('parseRange — explicit "bytes=start-end"', () => {
  it('bytes=100-200 → exact inclusive window', () => {
    expect(parseRange('bytes=100-200', SIZE)).toEqual({ start: 100, end: 200 })
  })
  it('clamps end past EOF to size-1', () => {
    expect(parseRange('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 })
  })
  it('single-byte range', () => {
    expect(parseRange('bytes=0-0', SIZE)).toEqual({ start: 0, end: 0 })
  })
  it('tolerates surrounding whitespace', () => {
    expect(parseRange('bytes= 10 - 20 ', SIZE)).toEqual({ start: 10, end: 20 })
  })
})

describe('parseRange — suffix "bytes=-N"', () => {
  it('bytes=-500 → last 500 bytes', () => {
    expect(parseRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 })
  })
  it('suffix larger than file → whole file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })
  it('bytes=-0 → unsatisfiable', () => {
    expect(parseRange('bytes=-0', SIZE)).toBe('unsatisfiable')
  })
})

describe('parseRange — unsatisfiable → 416', () => {
  it('start at EOF', () => {
    expect(parseRange('bytes=1000-1100', SIZE)).toBe('unsatisfiable')
  })
  it('start past EOF', () => {
    expect(parseRange('bytes=2000-', SIZE)).toBe('unsatisfiable')
  })
  it('any range against an empty file', () => {
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseRange('bytes=-10', 0)).toBe('unsatisfiable')
  })
})
