// Demo / smoke test for the F10 fact-checking + compliance layer.
// Runs four sample scripts through the gate (dry — no DB write) and prints the
// decision + reasoning for each, exercising every decision path.
//
//   npx tsx scripts/demo-compliance.ts
//
// Pure-logic checks (case selection, defamation, visual lint) work fully offline.
// The ≥2-source corroboration check needs network; with no connectivity those
// load-bearing claims read as "unverified" and correctly escalate to review.

import { runComplianceGate } from '../src/lib/compliance'
import type { TrueCrimeScript } from '../src/lib/compliance'

const NOW = '2026-06-11T00:00:00.000Z'

const cases: { label: string; expect: string; script: TrueCrimeScript }[] = [
  {
    label: 'A. Minor named',
    expect: 'block (case selection)',
    script: {
      caseName: 'The Riverside Case',
      narration: 'In 1998, a 12-year-old went missing after school. The case shocked the town.',
      subjects: [{ name: 'Jamie Doe', role: 'victim', living: false, isMinor: true }],
      targetDurationSec: 75,
    },
  },
  {
    label: 'B. Living acquitted person asserted guilty, no hedge',
    expect: 'block (defamation)',
    script: {
      caseName: 'State v. Harlan',
      narration:
        'Robert Harlan murdered the victim in cold blood and walked free. The jury got it wrong.',
      subjects: [{ name: 'Robert Harlan', role: 'acquitted', living: true, isMinor: false }],
      targetDurationSec: 70,
    },
  },
  {
    label: 'C. Convicted historical case, clean',
    expect: 'pass / route_to_review (corroboration needs network)',
    script: {
      caseName: 'The Lindbergh Kidnapping',
      narration:
        'In 1932, Bruno Hauptmann was convicted of the kidnapping and sentenced to death. ' +
        'The trial drew national attention and reshaped federal kidnapping law.',
      subjects: [{ name: 'Bruno Hauptmann', role: 'convicted', living: false, isMinor: false }],
      structure: {
        hookPattern: 'courtroom-reveal',
        sections: ['hook', 'crime', 'investigation', 'verdict'],
        visualStyle: 'sepia-archival',
      },
      targetDurationSec: 90,
    },
  },
  {
    label: 'D. Realistic AI likeness of a real person',
    expect: 'block (visual lint)',
    script: {
      caseName: 'The Lindbergh Kidnapping',
      narration: 'In 1932, Bruno Hauptmann was convicted of the kidnapping.',
      subjects: [{ name: 'Bruno Hauptmann', role: 'convicted', living: false, isMinor: false }],
      visuals: [
        {
          kind: 'image',
          source: 'replicate://flux/hauptmann-portrait',
          license: 'ai_generated',
          depictsRealPerson: true,
          aiGenerated: true,
        },
      ],
      targetDurationSec: 90,
    },
  },
  {
    label: 'E. Guilt asserted using the surname only',
    expect: 'block (defamation) — used to slip through, see issue #45',
    script: {
      caseName: 'State v. Smith',
      narration: 'Smith killed her in the kitchen. The jury never heard about the letters.',
      subjects: [
        { name: 'John Smith', role: 'acquitted', living: true, isMinor: false },
        { name: 'Mary Smith', role: 'victim', living: false, isMinor: false },
      ],
      claims: [],
      targetDurationSec: 90,
    },
  },
  {
    label: 'F. Narration names someone who is not in the subject list',
    expect: 'route_to_review (defamation) — used to pass silently, see issue #45',
    script: {
      caseName: 'The Garage Murder',
      narration: 'Marcus Webb strangled her in the garage. Investigators never found the weapon.',
      subjects: [{ name: 'Anna Reed', role: 'victim', living: false, isMinor: false }],
      claims: [],
      targetDurationSec: 90,
    },
  },
]

async function main() {
  for (const c of cases) {
    const report = await runComplianceGate(c.script, { generatedAt: NOW })
    console.log('\n' + '='.repeat(72))
    console.log(`${c.label}`)
    console.log(`  expected : ${c.expect}`)
    console.log(`  DECISION : ${report.decision.toUpperCase()}`)
    console.log(`  summary  : ${report.summary}`)
    if (report.caseSelection.hardBlocks.length)
      console.log(`  blocks   : ${report.caseSelection.hardBlocks.join(' | ')}`)
    for (const f of report.defamation)
      console.log(`  defam[${f.severity}] : ${f.reason}`)
    for (const f of report.visuals) console.log(`  visual[${f.severity}] : ${f.reason}`)
    if (report.disclosure.requiresAiVisualLabel)
      console.log('  disclose : AI visual label required at upload.')
  }
  console.log('\n' + '='.repeat(72))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
