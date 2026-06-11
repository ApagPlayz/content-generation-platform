// TTS stage. Narrates the script to a WAV. Three tiers, best available wins:
//   1. ElevenLabs (ELEVENLABS_API_KEY) — production voice, cost-ledgered.
//   2. macOS `say` — real local narration, $0, the default on this machine.
//   3. silent stub — a flat track sized to the estimated duration, so the
//      render stage still has an audio bed when no synth is available.
// Duration is measured with ffprobe (falls back to a words-per-second estimate).

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '../prisma'
import type { TtsResult } from './types'

const exec = promisify(execFile)
const MEDIA_DIR = path.join(process.cwd(), 'media')

// ElevenLabs Starter ≈ $0.18 / 1k characters (see Decision-and-Cost-Guide).
const ELEVENLABS_COST_PER_CHAR = 0.18 / 1000
const WORDS_PER_SEC = 2.6 // documentary narration pace

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
    const mp3 = path.join(path.dirname(wavPath), 'narration.mp3')
    await writeFile(mp3, Buffer.from(await res.arrayBuffer()))
    await exec('ffmpeg', ['-y', '-i', mp3, '-ar', '48000', '-ac', '1', wavPath])
    await unlink(mp3).catch(() => {})
    return existsSync(wavPath)
  } catch {
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

export async function synthesizeNarration(
  videoId: string,
  narration: string,
  voice?: string
): Promise<TtsResult> {
  const dir = path.join(MEDIA_DIR, videoId)
  await mkdir(dir, { recursive: true })
  const wavPath = path.join(dir, 'narration.wav')
  const estDuration = Math.max(8, narration.split(/\s+/).length / WORDS_PER_SEC)

  // Tier 1: ElevenLabs.
  if (await elevenLabs(narration, voice ?? 'Rachel', wavPath)) {
    await prisma.costLedger.create({
      data: {
        videoId,
        service: 'elevenlabs-tts',
        units: narration.length,
        unitCost: ELEVENLABS_COST_PER_CHAR,
        total: narration.length * ELEVENLABS_COST_PER_CHAR,
      },
    })
    return { audioPath: wavPath, durationSec: await probeDuration(wavPath, estDuration), provider: 'elevenlabs' }
  }

  // Tier 2: macOS say (free local).
  if (await macSay(narration, voice, wavPath)) {
    return { audioPath: wavPath, durationSec: await probeDuration(wavPath, estDuration), provider: 'macos-say' }
  }

  // Tier 3: silent stub.
  await silentStub(estDuration, wavPath)
  return { audioPath: wavPath, durationSec: estDuration, provider: 'silent-stub' }
}
