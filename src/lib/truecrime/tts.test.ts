// Issue #57: when the operator's PAID voice (ElevenLabs/OpenAI) has a key set
// but fails mid-run, synthesizeNarration must fall back to the free voice AND
// report the downgrade on `paidVoiceFallback` — while "no key set" (a config
// choice) must stay silent. These tests mock the network + ffmpeg/fs seams so
// only the provider-selection + failure-detection logic is exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}))
vi.mock('fs', () => ({ existsSync: () => true }))
vi.mock('child_process', () => ({
  // promisify(execFile) → call the trailing callback so every ffmpeg/ffprobe
  // invocation "succeeds" without touching the disk.
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') (cb as (e: unknown, r: unknown) => void)(null, { stdout: '', stderr: '' })
  },
}))
vi.mock('../prisma', () => ({ prisma: { costLedger: { create: vi.fn(async () => {}) } } }))
vi.mock('../settings', () => ({
  // Owner picked ElevenLabs (a paid voice) as their default provider.
  getSetting: vi.fn(async (key: string) => (key === 'default_tts_provider' ? 'elevenlabs' : undefined)),
}))

import { synthesizeNarration } from './tts'

const KOKORO_AUDIO = Buffer.from('fake-wav-bytes').toString('base64')

/** Route fetch by URL: ElevenLabs succeeds/fails per `elevenOk`; Kokoro always works. */
function stubFetch(elevenOk: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('api.elevenlabs.io')) {
        return { ok: elevenOk, status: elevenOk ? 200 : 401, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response
      }
      if (url.includes('/dev/captioned_speech')) {
        return { ok: true, json: async () => ({ audio: KOKORO_AUDIO, timestamps: [] }) } as unknown as Response
      }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response
    })
  )
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.ELEVENLABS_API_KEY
})

describe('synthesizeNarration paid-voice fallback (issue #57)', () => {
  it('flags a paid ElevenLabs failure and falls back to the free voice', async () => {
    process.env.ELEVENLABS_API_KEY = 'expired-key'
    stubFetch(false) // ElevenLabs returns HTTP 401
    const res = await synthesizeNarration('vid-fail', 'hello world this is a test narration line')
    expect(res.provider).toBe('kokoro')
    expect(res.paidVoiceFallback).toBeTruthy()
    expect(res.paidVoiceFallback?.failedProvider).toBe('elevenlabs')
    expect(res.paidVoiceFallback?.usedProvider).toBe('kokoro')
    expect(res.paidVoiceFallback?.detail).toBe('HTTP 401')
  })

  it('does NOT flag when no paid key is set (config choice, not a failure)', async () => {
    delete process.env.ELEVENLABS_API_KEY
    stubFetch(false)
    const res = await synthesizeNarration('vid-nokey', 'hello world this is a test narration line')
    expect(res.provider).toBe('kokoro')
    expect(res.paidVoiceFallback).toBeUndefined()
  })

  it('uses the paid voice with no flag when it works', async () => {
    process.env.ELEVENLABS_API_KEY = 'good-key'
    stubFetch(true)
    const res = await synthesizeNarration('vid-ok', 'hello world this is a test narration line')
    expect(res.provider).toBe('elevenlabs')
    expect(res.paidVoiceFallback).toBeUndefined()
  })
})
