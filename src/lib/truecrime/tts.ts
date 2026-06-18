// TTS stage. Narrates the script to a WAV. Several tiers; the operator's
// preferred provider (Settings → default_tts_provider) is tried first, then the
// chain falls back until one succeeds:
//   1. ElevenLabs (ELEVENLABS_API_KEY)            — premium, paid, cost-ledgered.
//   2. OpenAI TTS (OPENAI_API_KEY)                — good, cheap, cost-ledgered.
//   3. Kokoro (local OpenAI-compatible endpoint)  — natural, free, the default.
//   4. macOS `say`                                — real local narration, $0.
//   5. silent stub                                — flat track sized to duration.
// Kokoro is the recommended free default (see Updates/2026-06-17-voiceover-
// research.md): run kokoro-fastapi locally and it serves an OpenAI-compatible
// /v1/audio/speech endpoint at KOKORO_URL (default http://localhost:8880/v1).
// Duration is measured with ffprobe (falls back to a words-per-second estimate).

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '../prisma'
import { getSetting } from '../settings'
import type { TtsResult } from './types'

const exec = promisify(execFile)
const MEDIA_DIR = path.join(process.cwd(), 'media')

// ElevenLabs Starter ≈ $0.18 / 1k characters (see Decision-and-Cost-Guide).
const ELEVENLABS_COST_PER_CHAR = 0.18 / 1000
// OpenAI tts-1 ≈ $15 / 1M characters.
const OPENAI_COST_PER_CHAR = 15 / 1_000_000
const WORDS_PER_SEC = 2.6 // documentary narration pace

const DEFAULT_KOKORO_URL = 'http://localhost:8880/v1'
const DEFAULT_KOKORO_VOICE = 'af_bella' // warm, neutral default kokoro voice
const DEFAULT_OPENAI_VOICE = 'onyx' // deep, documentary-leaning openai voice

type ProviderName = TtsResult['provider']

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await exec('which', [cmd])
    return true
  } catch {
    return false
  }
}

async function probeDuration(file: string, fallback: number): Promise<number> {
  try {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nokey=1:noprint_wrappers=1',
      file,
    ])
    const d = parseFloat(stdout.trim())
    return Number.isFinite(d) && d > 0 ? d : fallback
  } catch {
    return fallback
  }
}

/** Normalise an arbitrary audio buffer to the 48kHz mono WAV the render expects. */
async function toWav(srcBytes: ArrayBuffer, ext: string, wavPath: string): Promise<boolean> {
  const tmp = path.join(path.dirname(wavPath), `narration.${ext}`)
  await writeFile(tmp, Buffer.from(srcBytes))
  await exec('ffmpeg', ['-y', '-i', tmp, '-ar', '48000', '-ac', '1', wavPath])
  await unlink(tmp).catch(() => {})
  return existsSync(wavPath)
}

async function elevenLabs(text: string, voice: string, wavPath: string): Promise<boolean> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          output_format: 'mp3_44100_128',
        }),
      }
    )
    if (!res.ok) return false
    return toWav(await res.arrayBuffer(), 'mp3', wavPath)
  } catch {
    return false
  }
}

async function openaiTts(text: string, voice: string, wavPath: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice || DEFAULT_OPENAI_VOICE,
        response_format: 'wav',
      }),
    })
    if (!res.ok) return false
    return toWav(await res.arrayBuffer(), 'wav', wavPath)
  } catch {
    return false
  }
}

/**
 * Kokoro via a local OpenAI-compatible endpoint (kokoro-fastapi). No API key,
 * runs on the operator's machine. Endpoint + voice are configurable in Settings
 * (kokoro_url / kokoro_voice) or via the KOKORO_URL env var.
 */
async function kokoro(text: string, voice: string, wavPath: string): Promise<boolean> {
  const base =
    (await getSetting('kokoro_url')) || process.env.KOKORO_URL || DEFAULT_KOKORO_URL
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: text,
        voice: voice || DEFAULT_KOKORO_VOICE,
        response_format: 'wav',
      }),
    })
    if (!res.ok) return false
    return toWav(await res.arrayBuffer(), 'wav', wavPath)
  } catch {
    // Endpoint not running — fall through to the next tier.
    return false
  }
}

async function macSay(text: string, voice: string | undefined, wavPath: string): Promise<boolean> {
  if (!(await commandExists('say'))) return false
  try {
    const aiff = path.join(path.dirname(wavPath), 'narration.aiff')
    const args = ['-o', aiff]
    if (voice) args.push('-v', voice)
    args.push(text)
    await exec('say', args, { timeout: 120_000 })
    await exec('ffmpeg', ['-y', '-i', aiff, '-ar', '48000', '-ac', '1', wavPath])
    await unlink(aiff).catch(() => {})
    return existsSync(wavPath)
  } catch {
    return false
  }
}

async function silentStub(seconds: number, wavPath: string): Promise<boolean> {
  try {
    await exec('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', `anullsrc=r=48000:cl=mono`,
      '-t', String(seconds),
      wavPath,
    ])
    return existsSync(wavPath)
  } catch {
    return false
  }
}

/** Order the provider chain so the operator's preferred provider is tried first. */
function providerChain(preferred: string): ProviderName[] {
  const base: ProviderName[] = ['kokoro', 'elevenlabs', 'openai-tts', 'macos-say']
  const map: Record<string, ProviderName> = {
    elevenlabs: 'elevenlabs',
    'openai-tts': 'openai-tts',
    kokoro: 'kokoro',
    'coqui-local': 'kokoro', // treat other "local free" picks as Kokoro
    'edge-tts': 'kokoro',
  }
  const head = map[preferred]
  const chain = head ? [head, ...base.filter((p) => p !== head)] : base
  return chain
}

export async function synthesizeNarration(
  videoId: string,
  narration: string,
  voice?: string
): Promise<TtsResult> {
  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })
  const wavPath = path.join(dir, 'narration.wav')
  const estDuration = Math.max(8, narration.split(/\s+/).length / WORDS_PER_SEC)

  const preferred = await getSetting('default_tts_provider')
  const voiceSetting = voice || (await getSetting('default_tts_voice')) || undefined

  for (const provider of providerChain(preferred)) {
    let ok = false
    if (provider === 'elevenlabs') ok = await elevenLabs(narration, voiceSetting ?? 'Rachel', wavPath)
    else if (provider === 'openai-tts') ok = await openaiTts(narration, voiceSetting ?? '', wavPath)
    else if (provider === 'kokoro') ok = await kokoro(narration, voiceSetting ?? '', wavPath)
    else if (provider === 'macos-say') ok = await macSay(narration, voiceSetting, wavPath)
    if (!ok) continue

    if (provider === 'elevenlabs') {
      await ledger(videoId, 'elevenlabs-tts', narration.length, ELEVENLABS_COST_PER_CHAR)
    } else if (provider === 'openai-tts') {
      await ledger(videoId, 'openai-tts', narration.length, OPENAI_COST_PER_CHAR)
    }
    return { audioPath: wavPath, durationSec: await probeDuration(wavPath, estDuration), provider }
  }

  // Final tier: silent stub so the render stage still has an audio bed.
  await silentStub(estDuration, wavPath)
  return { audioPath: wavPath, durationSec: estDuration, provider: 'silent-stub' }
}

async function ledger(videoId: string, service: string, units: number, unitCost: number) {
  await prisma.costLedger.create({
    data: { videoId, service, units, unitCost, total: units * unitCost },
  })
}
