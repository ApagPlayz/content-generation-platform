// Unit tests for plainPublishNote (src/lib/tools/publishReason.ts) — the pure
// mapping from a raw auto-publish failure reason to owner-facing copy (issue
// #15). Asserts each reason string maybeAutoPublish actually persists lands on
// the right sentence, and that unknown reasons are surfaced verbatim rather than
// swallowed. Pure-function test, matching the truecrime/* test style.

import { describe, expect, it } from 'vitest'
import { plainPublishNote } from './publishReason'

describe('plainPublishNote', () => {
  it('explains a missing YouTube connection and points to Settings', () => {
    const note = plainPublishNote('YouTube not connected')
    expect(note).toMatch(/^Not posted —/)
    expect(note).toContain('Settings')
    expect(note.toLowerCase()).toContain("isn't connected")
  })

  it('explains the daily upload limit for the persisted quota reason', () => {
    const note = plainPublishNote('daily upload quota reached (6/day)')
    expect(note).toMatch(/^Not posted —/)
    expect(note.toLowerCase()).toContain('upload limit')
    expect(note.toLowerCase()).toContain('tomorrow')
  })

  it('explains a missing rendered file', () => {
    const note = plainPublishNote(
      'Rendered MP4 not found for this video — render it before publishing.'
    )
    expect(note.toLowerCase()).toContain("couldn't be found")
  })

  it('surfaces an unknown upload error verbatim instead of swallowing it', () => {
    const note = plainPublishNote('The request failed with status code 403')
    expect(note).toBe('Not posted — The request failed with status code 403')
  })

  it('is case-insensitive on the reason match', () => {
    expect(plainPublishNote('YOUTUBE NOT CONNECTED').toLowerCase()).toContain(
      "isn't connected"
    )
  })

  it('returns a safe fallback for an empty or missing reason', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const note = plainPublishNote(empty)
      expect(note).toMatch(/^Not posted/)
      expect(note.length).toBeGreaterThan(0)
    }
  })
})
