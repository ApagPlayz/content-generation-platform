// Script stage. Turns a CaseBrief into a beat-structured TrueCrimeScript: an
// engineered opening hook plus an ordered set of beats that build rising action
// to a climax (~75–85% of runtime) and link causally with "but"/"therefore".
// The beats carry pacing + visual-cue hints the footage and render phases use.
//
// Uses Claude (Sonnet 5 by default) when factory.config.useAiScript is on AND
// ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is set; otherwise a deterministic
// template that narrates the (neutrally-worded) Wikipedia facts as beats and
// hedges guilt for any non-convicted subject — compliant-by-construction so
// the offline path still clears the gate. Pacing numbers (durations, cut
// cadence, music curve) are fixed in code; the model only fills language and
// visual cues.

import { prisma } from '../prisma'
import { resolveModel, claudeCallCost } from '../settings'
import { scoreHookCandidate } from '../tools/hookScore'
import type { ScriptStructure } from '../compliance'
import {
  loadRecentStyleProfiles,
  pickDivergentStyle,
  humanizeAngle,
  type StyleProfile,
} from './styleVariation'
import type {
  CaseBrief,
  F10FactoryConfig,
  F10Script,
  HookCandidate,
  HookType,
  ScriptBeat,
} from './types'

const HOOK_TYPES: HookType[] = [
  'open_loop',
  'statistic',
  'question',
  'in_media_res',
  'contradiction',
  'overlooked_detail',
  'timeline',
  'unresolved_mystery',
]

/** Fixed pacing per beat. Cut cadence tightens and music swells toward the
 *  climax; the climax lands at ~75–85% of runtime. Two templates by length. */
interface BeatSpec {
  name: string
  targetSeconds: number
  cutIntervalSec: number
  musicIntensity: number
  isClimax?: boolean
}

const BEATS_60: BeatSpec[] = [
  { name: 'Hook', targetSeconds: 4, cutIntervalSec: 3.5, musicIntensity: 0.3 },
  { name: 'Setup', targetSeconds: 8, cutIntervalSec: 3.5, musicIntensity: 0.35 },
  { name: 'Inciting detail', targetSeconds: 10, cutIntervalSec: 2.5, musicIntensity: 0.45 },
  { name: 'Rising complication', targetSeconds: 11, cutIntervalSec: 2.2, musicIntensity: 0.6 },
  { name: 'Turn / re-hook', targetSeconds: 12, cutIntervalSec: 2.0, musicIntensity: 0.7 },
  { name: 'Climax', targetSeconds: 9, cutIntervalSec: 1.2, musicIntensity: 0.95, isClimax: true },
  { name: 'Resolution', targetSeconds: 6, cutIntervalSec: 2.5, musicIntensity: 0.5 },
]

const BEATS_90: BeatSpec[] = [
  { name: 'Hook', targetSeconds: 5, cutIntervalSec: 3.5, musicIntensity: 0.3 },
  { name: 'Setup', targetSeconds: 10, cutIntervalSec: 3.5, musicIntensity: 0.35 },
  { name: 'Inciting detail', targetSeconds: 12, cutIntervalSec: 2.6, musicIntensity: 0.45 },
  { name: 'Rising complication', targetSeconds: 13, cutIntervalSec: 2.3, musicIntensity: 0.55 },
  { name: 'Rising complication 2', targetSeconds: 13, cutIntervalSec: 2.1, musicIntensity: 0.65 },
  { name: 'Turn / re-hook', targetSeconds: 10, cutIntervalSec: 1.8, musicIntensity: 0.75 },
  { name: 'Climax', targetSeconds: 13, cutIntervalSec: 1.2, musicIntensity: 0.95, isClimax: true },
  { name: 'Falling action', targetSeconds: 8, cutIntervalSec: 2.0, musicIntensity: 0.6 },
  { name: 'Resolution', targetSeconds: 6, cutIntervalSec: 2.5, musicIntensity: 0.5 },
]

const WORDS_PER_SEC = 2.7

function specsFor(targetDurationSec: number): BeatSpec[] {
  return targetDurationSec >= 80 ? BEATS_90 : BEATS_60
}

/** Structural signature reflects the real beats so the inauthentic-content
 *  variation check sees genuine per-case variety. The visual style + editorial
 *  angle come from the per-video divergent rotation (styleVariation) — replacing
 *  the old hardcoded constant that made every video look identical to the check. */
function structureFor(
  brief: CaseBrief,
  specs: BeatSpec[],
  hookType: string,
  style: StyleProfile
): ScriptStructure {
  return {
    hookPattern: brief.angle ? `operator-angle:${hookType}` : hookType,
    sections: specs.map((s) => s.name.toLowerCase()),
    visualStyle: style.visualStyle,
    editorialAngle: style.editorialAngle,
  }
}

export async function generateScript(
  videoId: string,
  playbook: string,
  brief: CaseBrief,
  config: F10FactoryConfig
): Promise<F10Script> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
  const targetDurationSec = config.targetDurationSec ?? 75
  const specs = specsFor(targetDurationSec)
  const citations = [brief.wikipediaUrl]

  // Force this video's look + editorial framing to DIVERGE from recent runs — the
  // active defence against the "inauthentic content" policy. Best-effort + keyless:
  // an empty corpus falls back to a deterministic per-case pick.
  const window = config.styleDivergenceWindow ?? 5
  const style = pickDivergentStyle(await loadRecentStyleProfiles(window), {
    caseName: brief.caseName,
    pool: config.styleRotation,
    angles: config.editorialAngles,
    window,
  })
  const editorialLayer = config.enableEditorialLayer !== false

  if (!config.useAiScript || !apiKey) {
    return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
  }

  const m = await resolveModel(config.scriptModel ?? 'sonnet5')
  const wordBudget = Math.round(targetDurationSec * WORDS_PER_SEC)

  try {
    const subjectLines = brief.subjects
      .map((s) => `- ${s.name}: role=${s.role}, living=${s.living}, minor=${s.isMinor}`)
      .join('\n')

    const beatGuide = specs
      .map(
        (s, i) =>
          `${i + 1}. ${s.name} (~${s.targetSeconds}s, ~${Math.round(s.targetSeconds * WORDS_PER_SEC)} words)` +
          (s.isClimax ? ' ← CLIMAX / key reveal' : '')
      )
      .join('\n')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: m.model,
        max_tokens: 2200,
        system: [
          {
            type: 'text',
            text:
              `${playbook}\n\n` +
              'You write a documentary-tone, faceless true-crime SHORT as a structured ' +
              'dramatic arc. Internally brainstorm several hook angles (open_loop, statistic, ' +
              'question, in_media_res, contradiction, overlooked_detail, timeline, ' +
              'unresolved_mystery) and output only the single strongest hook.\n\n' +
              'STORYTELLING RULES:\n' +
              `- Total spoken narration ≈ ${wordBudget} words across the beats below.\n` +
              '- Every beat after the Hook MUST connect to the previous beat with "but" or ' +
              '"therefore" (causal), never "and then" (sequential). Set linkWord accordingly.\n' +
              '- Build rising tension; the CLIMAX beat carries the key documented reveal or the ' +
              'central unresolved question. Include a mid-video re-hook at the Turn beat.\n' +
              '- The hook fires 3 layers: verbal (10–14 words, calm, lands in 3s), onscreenText ' +
              '(≤7 words, NOT a copy of the verbal line), visualCue (a non-graphic opening shot).\n\n' +
              'HARD COMPLIANCE RULES:\n' +
              '- Never assert guilt as fact about anyone whose role is not "convicted"; use ' +
              '"alleged/accused/charged/reportedly" and ATTRIBUTE contested claims ("investigators ' +
              'say", "according to court records"). Set sourceAttribution on any beat with a ' +
              'contested claim, and complianceFlag = factual | attributed | opinion-clear.\n' +
              '- Never name or depict minors. No gore; focus on investigation/timeline/mystery. ' +
              'Build tension from documented unresolved facts, not speculation.\n\n' +
              (editorialLayer
                ? `EDITORIAL FRAMING: present this as a "${humanizeAngle(style.editorialAngle)}" — ` +
                  'original analytical commentary on the documented record, not a bare recap. The ' +
                  'framing must ADD analysis; it must never introduce a new accusation and every ' +
                  'factual claim stays attributed and hedged.\n\n'
                : '') +
              `BEAT TEMPLATE (return EXACTLY ${specs.length} beats, in this order):\n${beatGuide}\n\n` +
              'Respond with ONLY JSON: {"hook":{"type","verbal","onscreenText","visualCue",' +
              '"opensLoop","payoffRef"},"beats":[{"name","narration","linkWord","visualCue",' +
              '"captionEmphasisWord","sourceAttribution","complianceFlag"}],"title"(≤80 chars),' +
              '"description","hashtags"(5-8, no #)}. The first beat\'s narration is the hook verbal line.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              `Case: ${brief.caseName}\nYear: ${brief.year ?? 'unknown'}\n` +
              `Angle: ${brief.angle ?? '(choose a fresh one)'}\n` +
              `Subjects:\n${subjectLines}\n\nVerified facts:\n${brief.facts.join('\n')}`,
          },
        ],
      }),
    })
    if (!res.ok) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)

    const data = await res.json()
    const { total, units } = claudeCallCost(data.usage ?? {}, m)
    await prisma.costLedger.create({
      data: { videoId, service: m.model, units, unitCost: m.inputCostPerToken, total },
    })

    const text: string = data.content?.[0]?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
    const parsed = JSON.parse(jsonMatch[0])

    const built = buildFromModel(parsed, specs)
    if (!built) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)

    const fallback = templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
    const hookGate = scoreHookCandidate(built.hook)
    return {
      caseName: brief.caseName,
      subjects: brief.subjects,
      narration: built.narration,
      visuals: [],
      citations,
      targetDurationSec,
      structure: structureFor(brief, specs, built.hook.type, style),
      hook: built.hook,
      beats: built.beats,
      hookScore: hookGate.score,
      hookStyle: hookGate.style,
      title: parsed.title ? String(parsed.title).slice(0, 100) : fallback.title,
      description: parsed.description ? String(parsed.description) : fallback.description,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : fallback.hashtags,
    }
  } catch {
    return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
  }
}

/** Validate + normalize the model's JSON into a hook + beats, zipping the
 *  fixed pacing template onto each beat. Returns null if the shape is unusable
 *  (caller falls back to the template script). */
function buildFromModel(
  parsed: unknown,
  specs: BeatSpec[]
): { hook: HookCandidate; beats: ScriptBeat[]; narration: string } | null {
  const p = parsed as {
    hook?: Partial<HookCandidate>
    beats?: Array<Partial<ScriptBeat>>
  }
  const rawBeats = Array.isArray(p.beats) ? p.beats : []
  if (rawBeats.length === 0 || !p.hook?.verbal) return null

  const beats: ScriptBeat[] = specs.map((spec, i) => {
    const rb = rawBeats[i] ?? {}
    const narration = String(rb.narration ?? '').trim()
    return {
      name: spec.name,
      index: i,
      narration,
      targetSeconds: spec.targetSeconds,
      linkWord: rb.linkWord === 'but' || rb.linkWord === 'therefore' ? rb.linkWord : i === 0 ? undefined : 'therefore',
      visualCue: String(rb.visualCue ?? '').trim() || defaultVisualCue(spec.name),
      cutIntervalSec: spec.cutIntervalSec,
      musicIntensity: spec.musicIntensity,
      captionEmphasisWord: rb.captionEmphasisWord ? String(rb.captionEmphasisWord) : undefined,
      sourceAttribution: rb.sourceAttribution ? String(rb.sourceAttribution) : undefined,
      complianceFlag:
        rb.complianceFlag === 'attributed' || rb.complianceFlag === 'opinion-clear'
          ? rb.complianceFlag
          : 'factual',
    }
  })

  const hookType = (HOOK_TYPES as string[]).includes(String(p.hook.type))
    ? (p.hook.type as HookType)
    : 'open_loop'
  const hook: HookCandidate = {
    type: hookType,
    verbal: String(p.hook.verbal).trim(),
    onscreenText: String(p.hook.onscreenText ?? '').trim().split(/\s+/).slice(0, 7).join(' '),
    visualCue: String(p.hook.visualCue ?? '').trim() || defaultVisualCue('Hook'),
    opensLoop: String(p.hook.opensLoop ?? '').trim(),
    payoffRef: p.hook.payoffRef ? String(p.hook.payoffRef) : 'Climax',
  }

  // The spoken hook is exactly the chosen verbal line.
  beats[0].narration = hook.verbal

  // Reject if too many beats came back empty (model didn't follow the template).
  if (beats.filter((b) => b.narration.length > 0).length < Math.ceil(specs.length / 2)) return null

  const narration = beats
    .map((b) => b.narration)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { hook, beats, narration }
}

/** Generic, person-free mood cue per beat — the safe default the footage stage
 *  searches for. Never references the real people/case. */
function defaultVisualCue(beatName: string): string {
  const n = beatName.toLowerCase()
  // Order matters: check 'turn' before 'hook' so "Turn / re-hook" doesn't match.
  if (n.includes('turn')) return 'empty courtroom, cold light'
  if (n.startsWith('hook')) return 'slow push-in on an old case file, dim light'
  if (n.includes('setup')) return 'establishing shot, quiet street at dusk'
  if (n.includes('inciting')) return 'newspaper clipping, shallow focus'
  if (n.includes('rising')) return 'rain on a window at night'
  if (n.includes('climax')) return 'redacted document close-up, rapid focus'
  if (n.includes('falling')) return 'long empty road, overcast'
  return 'archival photograph, slow drift'
}

// ─────────────────────────── Offline / fallback template ───────────────────────────

function hedge(brief: CaseBrief): string {
  const unproven = brief.subjects.filter((s) => s.role === 'accused' || s.role === 'acquitted')
  if (unproven.length === 0) return ''
  const acquitted = unproven.filter((s) => s.role === 'acquitted').map((s) => s.name)
  if (acquitted.length > 0) {
    return `${acquitted.join(' and ')} ${acquitted.length > 1 ? 'were' : 'was'} acquitted; nothing here asserts guilt.`
  }
  return `The allegations against ${unproven.map((s) => s.name).join(' and ')} remain unproven in court.`
}

/** Deterministic beat script from the neutral Wikipedia facts. Compliant by
 *  construction: attributes claims, hedges guilt, never invents a resolution. */
function templateScript(
  brief: CaseBrief,
  specs: BeatSpec[],
  targetDurationSec: number,
  citations: string[],
  style: StyleProfile,
  editorialLayer: boolean
): F10Script {
  const facts = brief.facts.length ? brief.facts : [brief.summary.slice(0, 200)]
  const hedgeLine = hedge(brief)
  const hasAngle = !!brief.angle?.trim()
  const lastFact = facts[facts.length - 1]
  // A generic, hedged editorial frame — NEVER a case-specific assertion, so it
  // can't trip the defamation lint or the corroboration rule. Off when the
  // operator disables the editorial layer.
  const angleWords = editorialLayer ? humanizeAngle(style.editorialAngle) : ''
  const editorialClose = angleWords ? ` This ${angleWords} sticks to what the public record documents.` : ''

  // Varied fillers so a fact-poor case never repeats the same line verbatim.
  const fillers = [
    'Investigators kept returning to the same unanswered questions.',
    'The timeline is where the case gets complicated.',
    'The official account still left gaps that were never fully closed.',
  ]
  let fillerIdx = 0

  // The hook is the crafted angle when the operator supplied one (tight,
  // scroll-stopping); otherwise the first verified sentence. Content beats then
  // walk the remaining facts in order — reserving the LAST fact for the climax —
  // so none repeat and the strongest fact lands at the peak.
  let cursor = hasAngle ? 0 : 1 // if no angle, facts[0] is spent on the hook
  const nextFact = (): string => {
    if (cursor < facts.length - 1) return facts[cursor++]
    return fillers[fillerIdx++ % fillers.length]
  }

  const beatTexts: string[] = specs.map((spec, i) => {
    const n = spec.name.toLowerCase()
    if (i === 0) return (hasAngle ? brief.angle! : facts[0]).trim()
    if (n.includes('climax'))
      return `According to public records and reporting, this is the part that still draws scrutiny. ${lastFact}`.trim()
    if (n.includes('resolution'))
      return `${hedgeLine}${editorialClose} The full account is documented at the source linked below.`.trim()
    // Setup / inciting / rising / turn / falling: next unused fact.
    return nextFact()
  })

  const beats: ScriptBeat[] = specs.map((spec, i) => ({
    name: spec.name,
    index: i,
    narration: beatTexts[i],
    targetSeconds: spec.targetSeconds,
    linkWord: i === 0 ? undefined : i % 2 === 0 ? 'therefore' : 'but',
    visualCue: defaultVisualCue(spec.name),
    cutIntervalSec: spec.cutIntervalSec,
    musicIntensity: spec.musicIntensity,
    sourceAttribution: spec.name.toLowerCase().includes('climax') ? 'public records and reporting' : undefined,
    complianceFlag: spec.name.toLowerCase().includes('climax') ? 'attributed' : 'factual',
  }))

  const hook: HookCandidate = {
    type: 'unresolved_mystery',
    verbal: beatTexts[0],
    onscreenText: `${brief.caseName}`.split(/\s+/).slice(0, 7).join(' '),
    visualCue: defaultVisualCue('Hook'),
    opensLoop: angleWords ? `a ${angleWords} of what the record actually shows` : 'what the record actually shows',
    payoffRef: 'Resolution',
  }

  const narration = beats
    .map((b) => b.narration)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const yr = brief.year ? ` (${brief.year})` : ''
  const hookGate = scoreHookCandidate(hook)
  return {
    caseName: brief.caseName,
    subjects: brief.subjects,
    narration,
    visuals: [],
    citations,
    targetDurationSec,
    structure: structureFor(brief, specs, hook.type, style),
    hook,
    beats,
    hookScore: hookGate.score,
    hookStyle: hookGate.style,
    title: `${brief.caseName}${yr}: what really happened`.slice(0, 100),
    description:
      (facts[0] ?? brief.summary.slice(0, 160)) +
      (angleWords ? ` A ${angleWords} of the documented record.` : '') +
      ` Source: ${brief.wikipediaUrl}`,
    hashtags: ['truecrime', 'coldcase', 'mystery', 'history', 'unsolved'],
  }
}
