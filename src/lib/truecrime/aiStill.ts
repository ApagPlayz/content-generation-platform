// AI-still footage source for the F10 True Crime pipeline. Generates ONE
// atmospheric still per script beat from `ScriptBeat.visualCue`, tagged as a
// compliant VisualAsset so it passes visualLint and correctly trips the
// AI-disclosure label via buildDisclosurePlan.
//
// COMPLIANCE (non-negotiable): AI stills are SYMBOLIC / ATMOSPHERIC ONLY —
// never a likeness of a real person. That rule is baked into prompt
// construction (a hard negative constraint forbidding faces / identifiable
// people) and every asset is honestly tagged { aiGenerated:true,
// depictsRealPerson:false, license:'ai_generated' }. We NEVER request a real
// person, so depictsRealPerson:false is truthful — visualLint's hard block
// (aiGenerated AND depictsRealPerson) stays a real safeguard, not a bypass.
//
// Providers (chosen by opts.provider / AI_IMAGE_PROVIDER, else auto by key):
//   • 'openai'    — POST /v1/images/generations (OPENAI_API_KEY).
//   • 'stability' — POST /v2beta/stable-image/generate/core (STABILITY_API_KEY).
//   • 'local'     — keyless ffmpeg lavfi gradient/solid still. ALWAYS available
//                   as the final fallback so a frame per beat always exists.
// Any provider error (no key, non-OK, timeout, throw) falls through to the
// keyless local gradient for that beat — this module never hard-fails.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '../prisma'
import type { VisualAsset } from '../compliance'
import type { ScriptBeat } from './types'

const exec = promisify(execFile)
const MEDIA_DIR = path.join(process.cwd(), 'media')

// Rough per-image cost for the paid providers (cost-ledger only; best-effort).
// OpenAI gpt-image-1 (portrait, standard) ≈ $0.04; Stability Core ≈ $0.03.
const OPENAI_IMAGE_COST = 0.04
const STABILITY_IMAGE_COST = 0.03

// The hard style/negative prompt appended to EVERY AI-still prompt. Keeps output
// abstract/atmospheric and forbids any real-person likeness.
const SAFE_STYLE = 'muted cinematic true-crime atmosphere, symbolic and abstract, moody low-key lighting'
const NEGATIVE_CONSTRAINT =
  'No real people, no identifiable faces, no portraits, no crowds, no recognizable individuals. ' +
  'Symbolic environmental / still-life imagery only (objects, places, textures, weather, light).'

export interface AiStillOpts {
  /** Run scratch dir owner — stills land in media/<videoId>/. */
  videoId: string
  /** Beat position → filename ai-NN.jpg + deterministic tint. Defaults to beat.index. */
  index?: number
  /** 'openai' | 'stability' | 'local'. Falls back to auto/local when unset. */
  provider?: string
  /** AI image model id (e.g. 'gpt-image-1'). Provider-specific; optional. */
  model?: string
  /** Style suffix appended to the prompt (config.aiStillStyle). */
  style?: string
  /** Explicit API key override; otherwise read from env per provider. */
  apiKey?: string
  /** Network timeout for a paid provider call. Default 60s. */
  timeoutMs?: number
}

type ResolvedProvider = 'openai' | 'stability' | 'local'

/** Resolve which provider to use, honouring explicit choice then available keys. */
function resolveProvider(opts: AiStillOpts): ResolvedProvider {
  const explicit = (opts.provider || process.env.AI_IMAGE_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'openai' || explicit === 'stability' || explicit === 'local') return explicit
  // Auto: prefer whatever key is present; keyless → local gradient.
  if (opts.apiKey || process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.STABILITY_API_KEY) return 'stability'
  return 'local'
}

/** Build the compliant prompt from the beat's visual cue + style + negatives. */
function buildPrompt(beat: ScriptBeat, style?: string): string {
  const cue = (beat.visualCue || 'a quiet, tense empty scene').trim()
  const styleSuffix = (style || SAFE_STYLE).trim()
  return `${cue}. ${styleSuffix}. ${NEGATIVE_CONSTRAINT}`
}

// ── Keyless local gradient still ───────────────────────────────────────────

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await exec('which', ['ffmpeg'])
    return true
  } catch {
    return false
  }
}

let _gradientsFilter: boolean | null = null
async function hasGradientsFilter(): Promise<boolean> {
  if (_gradientsFilter !== null) return _gradientsFilter
  try {
    const { stdout } = await exec('ffmpeg', ['-hide_banner', '-filters'])
    _gradientsFilter = /\bgradients\b/.test(stdout)
  } catch {
    _gradientsFilter = false
  }
  return _gradientsFilter
}

/** Deterministic dark duotone from beat index + musicIntensity (0..1). */
function tintPair(index: number, musicIntensity: number): { c0: string; c1: string } {
  // Rotate hue by beat so consecutive stills differ; keep it dark/muted.
  const hue = (index * 47) % 360
  const intensity = Math.max(0, Math.min(1, musicIntensity || 0))
  const light0 = 0.08 + intensity * 0.06 // base shadow tone
  const light1 = 0.18 + intensity * 0.12 // slightly lifted highlight
  return { c0: hslHex(hue, 0.28, light0), c1: hslHex((hue + 24) % 360, 0.34, light1) }
}

function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `0x${to(r)}${to(g)}${to(b)}`
}

/** Render a single-frame atmospheric still via ffmpeg lavfi. */
async function localGradientStill(beat: ScriptBeat, index: number, out: string): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false
  const { c0, c1 } = tintPair(index, beat.musicIntensity ?? 0)
  const input = (await hasGradientsFilter())
    ? `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:nb_colors=2`
    : `color=c=${c0}:s=1080x1920`
  try {
    await exec(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', input, '-frames:v', '1', '-q:v', '3', out],
      { timeout: 60_000 }
    )
    return existsSync(out)
  } catch {
    return false
  }
}

// ── Paid provider calls (key-gated, best-effort) ────────────────────────────

async function writeBytes(out: string, buf: Buffer): Promise<boolean> {
  try {
    const { writeFile } = await import('fs/promises')
    await writeFile(out, buf)
    return existsSync(out)
  } catch {
    return false
  }
}

async function openAiStill(prompt: string, out: string, opts: AiStillOpts): Promise<boolean> {
  const key = opts.apiKey || process.env.OPENAI_API_KEY
  if (!key) return false
  const model = opts.model || 'gpt-image-1'
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1536' }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
    const item = data.data?.[0]
    if (!item) return false
    if (item.b64_json) return writeBytes(out, Buffer.from(item.b64_json, 'base64'))
    if (item.url) {
      const img = await fetch(item.url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) })
      if (!img.ok) return false
      return writeBytes(out, Buffer.from(await img.arrayBuffer()))
    }
    return false
  } catch {
    return false
  }
}

async function stabilityStill(prompt: string, out: string, opts: AiStillOpts): Promise<boolean> {
  const key = opts.apiKey || process.env.STABILITY_API_KEY
  if (!key) return false
  try {
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('negative_prompt', NEGATIVE_CONSTRAINT)
    form.append('aspect_ratio', '9:16')
    form.append('output_format', 'jpeg')
    const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, Accept: 'image/*' },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
    if (!res.ok) return false
    return writeBytes(out, Buffer.from(await res.arrayBuffer()))
  } catch {
    return false
  }
}

async function logCost(videoId: string, service: string, unitCost: number): Promise<void> {
  try {
    await prisma.costLedger.create({
      data: { videoId, service, units: 1, unitCost, total: unitCost },
    })
  } catch {
    // Cost logging is best-effort; never let it break still generation.
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate one atmospheric still for a single beat. Tries the configured paid
 * provider (if a key is present), then always falls back to the keyless local
 * gradient. Returns the local file path and the provider that actually produced
 * it. On total failure (e.g. ffmpeg missing AND no key) returns provider:'none'
 * with an empty path — callers should verify the path exists.
 */
export async function generateStillForBeat(
  beat: ScriptBeat,
  opts: AiStillOpts
): Promise<{ path: string; provider: string }> {
  const index = opts.index ?? beat.index ?? 0
  const dir = path.join(MEDIA_DIR, opts.videoId)
  await mkdir(dir, { recursive: true })
  // Deterministic filename → idempotent overwrite on a retried visuals stage.
  const out = path.join(dir, `ai-${String(index).padStart(2, '0')}.jpg`)
  const prompt = buildPrompt(beat, opts.style)
  const chosen = resolveProvider(opts)

  if (chosen === 'openai') {
    if (await openAiStill(prompt, out, opts)) {
      await logCost(opts.videoId, opts.model || 'gpt-image-1', OPENAI_IMAGE_COST)
      return { path: out, provider: 'openai' }
    }
  } else if (chosen === 'stability') {
    if (await stabilityStill(prompt, out, opts)) {
      await logCost(opts.videoId, 'stability-core', STABILITY_IMAGE_COST)
      return { path: out, provider: 'stability' }
    }
  }

  // Keyless fallback (also the direct path when chosen === 'local').
  if (await localGradientStill(beat, index, out)) {
    return { path: out, provider: 'local' }
  }
  return { path: '', provider: 'none' }
}

/**
 * Batch helper mirroring sourceVisuals' return shape: generate a still per beat
 * and return the compliant VisualAssets + their local paths (parallel arrays,
 * filtered to successes). Caps at opts.maxImages. Every asset is honestly tagged
 * as AI-generated, no real person — so visualLint passes and the AI-disclosure
 * label fires. Intended to be called by the orchestrator visuals stage.
 */
export async function generateAiStills(
  videoId: string,
  beats: ScriptBeat[],
  opts: Omit<AiStillOpts, 'videoId' | 'index'> & { maxImages?: number } = {}
): Promise<{ visuals: VisualAsset[]; imagePaths: string[] }> {
  const cap = opts.maxImages && opts.maxImages > 0 ? opts.maxImages : beats.length
  const visuals: VisualAsset[] = []
  const imagePaths: string[] = []

  for (let i = 0; i < beats.length && visuals.length < cap; i++) {
    const beat = beats[i]
    const beatIndex = beat.index ?? i
    const { path: stillPath, provider } = await generateStillForBeat(beat, {
      ...opts,
      videoId,
      index: beatIndex,
    })
    if (!stillPath || !existsSync(stillPath)) continue
    visuals.push({
      kind: 'image',
      source: `ai-still:${provider}:${beatIndex}`,
      license: 'ai_generated',
      depictsRealPerson: false, // truthful: prompts forbid real-person likenesses
      aiGenerated: true,
      beatIndex,
    })
    imagePaths.push(stillPath)
  }

  return { visuals, imagePaths }
}
