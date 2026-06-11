// Visual / audio license + AI-likeness lint. Enforces the asset-provenance
// rules: prefer public-domain, never use realistic AI likenesses of real people,
// require a logged license ref for fair-use and licensed assets, and produce the
// platform AI-disclosure plan.

import type { DisclosurePlan, VisualAsset, VisualFlag } from './types'

export function visualLint(visuals: VisualAsset[]): VisualFlag[] {
  const flags: VisualFlag[] = []

  for (const asset of visuals) {
    // 1) Realistic AI likeness of a real person — the single biggest emerging
    // risk ("resurrected victims" backlash). Hard block.
    if (asset.aiGenerated && asset.depictsRealPerson) {
      flags.push({
        severity: 'block',
        asset,
        reason:
          'Realistic AI-generated likeness of a real person. Prohibited — use abstract/symbolic AI visuals or PD/licensed imagery instead.',
      })
      continue
    }

    // 2) Unknown license — can't ship an asset we can't account for.
    if (asset.license === 'unknown') {
      flags.push({
        severity: 'review',
        asset,
        reason: `Asset from "${asset.source}" has unknown license. Resolve provenance or replace.`,
      })
    }

    // 3) Fair-use / licensed assets must carry a logged license ref.
    if ((asset.license === 'fair_use' || asset.license === 'licensed') && !asset.licenseRef) {
      flags.push({
        severity: 'review',
        asset,
        reason: `${asset.license} asset from "${asset.source}" is missing a logged license id / attribution.`,
      })
    }

    // 4) Fair-use mugshot of a real person — allowed (transformative commentary)
    // but surface it so the operator confirms newsworthiness/attribution.
    if (asset.license === 'fair_use' && asset.depictsRealPerson) {
      flags.push({
        severity: 'warn',
        asset,
        reason:
          'Fair-use image of a real person (e.g. state/local mugshot). Allowed as transformative commentary — confirm it is attributed and not gratuitous.',
      })
    }
  }

  return flags
}

export function buildDisclosurePlan(visuals: VisualAsset[]): DisclosurePlan {
  const notes: string[] = []

  // Realistic synthetic visuals depicting the real case → AI visual label.
  const aiVisualOfCase = visuals.some(
    (v) => v.aiGenerated && (v.kind === 'image' || v.kind === 'video') && v.depictsRealPerson
  )
  const anyAiVisual = visuals.some((v) => v.aiGenerated && v.kind !== 'music')
  const aiMusic = visuals.some((v) => v.aiGenerated && v.kind === 'music')

  if (anyAiVisual) {
    notes.push(
      'Set the YouTube "altered or synthetic content" flag and add TikTok/IG AI labels at upload.'
    )
  }
  if (aiMusic) notes.push('AI-generated music present — add the audio AI label.')
  notes.push(
    'A synthetic narrator voice that does NOT impersonate a real person generally does not require disclosure.'
  )

  return {
    requiresAiVisualLabel: anyAiVisual || aiVisualOfCase,
    requiresAiAudioLabel: aiMusic,
    notes,
  }
}
