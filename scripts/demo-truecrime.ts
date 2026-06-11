// End-to-end dry run of the F10 pipeline WITHOUT the database or render — proves
// discover → script → visuals(metadata) → compliance gate wiring against live
// free APIs (Wikipedia, Wikidata, Wikimedia Commons, CourtListener).
//
//   npx tsx scripts/demo-truecrime.ts
//
// The full DB-backed pipeline (TTS + ffmpeg render) runs via the seeded agent:
//   node scripts/seed-truecrime.mjs  then POST /api/agents/<id>/run

import { discoverCase } from '../src/lib/truecrime/caseDiscovery'
import { generateScript } from '../src/lib/truecrime/script'
import { runComplianceGate } from '../src/lib/compliance'
import type { F10FactoryConfig } from '../src/lib/truecrime/types'

const config: F10FactoryConfig = {
  targetDurationSec: 75,
  caseWatchlist: [
    {
      caseName: 'The Lizzie Borden Case',
      wikipediaTitle: 'Lizzie Borden',
      angle: 'Why the evidence never convinced the jury.',
      subjects: [{ name: 'Lizzie Borden', role: 'acquitted', living: false, isMinor: false }],
    },
  ],
}

async function main() {
  console.log('① discover…')
  const brief = await discoverCase(config)
  console.log(`   case   : ${brief.caseName} (${brief.year ?? '?'})`)
  console.log(`   wiki   : ${brief.wikipediaUrl}`)
  console.log(`   facts  : ${brief.facts.length} pulled`)
  if (brief.livingWarnings.length) console.log(`   ⚠ living: ${brief.livingWarnings.join(' ')}`)

  console.log('② script… (template fallback unless ANTHROPIC_API_KEY set)')
  const script = await generateScript('demo', 'demo playbook', brief, config)
  console.log(`   title  : ${script.title}`)
  console.log(`   narr   : ${script.narration.slice(0, 160)}…`)

  console.log('③ compliance gate…')
  const report = await runComplianceGate(script, { generatedAt: '2026-06-11T00:00:00Z' })
  console.log(`   DECISION : ${report.decision.toUpperCase()}`)
  console.log(`   summary  : ${report.summary}`)
  for (const f of report.defamation) console.log(`   defam[${f.severity}] : ${f.reason}`)
  console.log(`   legal    : ${report.legalStatus.map((l) => `${l.name}=${l.status}(guilt:${l.guiltAssertable})`).join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
