import { describe, expect, it } from 'vitest'

// The defamation lint is the single thing standing between an autonomous
// true-crime post and a defamation claim. It had zero tests. These lock the
// behaviour the gate depends on — in particular that a subject stored as
// "John Smith" is still caught when the narration only says "Smith", and that a
// name the script never declared can't slip through unchecked (issue #45).

import { actorNames, defamationLint, nameVariants } from './defamationLint'
import type { CaseSubject, LegalStatusResult } from './types'

const subj = (name: string, o: Partial<CaseSubject> = {}): CaseSubject => ({
  name,
  role: 'acquitted',
  living: true,
  isMinor: false,
  ...o,
})

const assertable = (name: string): LegalStatusResult[] => [
  { name, status: 'convicted', evidence: [], guiltAssertable: true, notes: '' },
]

const NO_STATUS: LegalStatusResult[] = []

const sev = (flags: ReturnType<typeof defamationLint>) => flags.map((f) => f.severity)

// ─────────────────────────── nameVariants ───────────────────────────

describe('nameVariants', () => {
  it('derives the full name, the surname and the given name', () => {
    expect(nameVariants('John Smith')).toEqual(['John Smith', 'Smith', 'John'])
  })

  it('keeps particles with the surname ("Dick Van Dyke" → "Van Dyke")', () => {
    expect(nameVariants('Dick Van Dyke')).toContain('Van Dyke')
    expect(nameVariants('Dick Van Dyke')).not.toContain('Dyke')
  })

  it('strips a generational suffix before picking the surname', () => {
    expect(nameVariants('John Smith Jr.')).toContain('Smith')
  })

  it('does not treat a leading initial as a usable given name', () => {
    expect(nameVariants('J. Smith')).toEqual(['J. Smith', 'Smith'])
  })

  it('returns only the full name for a single-token name', () => {
    expect(nameVariants('Madonna')).toEqual(['Madonna'])
  })

  it('drops sub-3-character partials that would match almost anything', () => {
    // "Wei" is a usable surname; the 2-character given name "Li" is not — as a
    // bare token it would match far too much ordinary prose.
    expect(nameVariants('Li Wei')).toEqual(['Li Wei', 'Wei'])
  })
})

// ────────────────── existing behaviour must not regress ──────────────────

describe('defamationLint — full stored name', () => {
  it('blocks an unhedged guilt assertion about a living, non-convicted person', () => {
    const flags = defamationLint(
      'Robert Harlan murdered the victim in cold blood.',
      [subj('Robert Harlan')],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['block'])
    expect(flags[0].subjectName).toBe('Robert Harlan')
  })

  it('downgrades the same sentence to warn when it is hedged', () => {
    const flags = defamationLint(
      'Robert Harlan allegedly murdered the victim.',
      [subj('Robert Harlan')],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['warn'])
  })

  it('routes a deceased, non-adjudicated subject to review rather than block', () => {
    const flags = defamationLint(
      'Robert Harlan murdered the victim in cold blood.',
      [subj('Robert Harlan', { living: false })],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['review'])
  })

  it('stays silent when the person is guilt-assertable (convicted)', () => {
    const flags = defamationLint(
      'Bruno Hauptmann murdered the child.',
      [subj('Bruno Hauptmann', { role: 'convicted', living: false })],
      assertable('Bruno Hauptmann')
    )
    expect(flags).toEqual([])
  })

  it('stays silent when there is no guilt verb', () => {
    const flags = defamationLint(
      'Robert Harlan attended every day of the hearing.',
      [subj('Robert Harlan')],
      NO_STATUS
    )
    expect(flags).toEqual([])
  })

  it('matches the stored full name case-insensitively', () => {
    const flags = defamationLint(
      'ROBERT HARLAN murdered the victim.',
      [subj('Robert Harlan')],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['block'])
  })

  it('flags "the real killer" speculation as review with no subjectName', () => {
    const flags = defamationLint('The real killer is still out there.', [], NO_STATUS)
    expect(sev(flags)).toEqual(['review'])
    expect(flags[0].subjectName).toBeUndefined()
  })

  it('attaches a hedged rewrite to a block flag', () => {
    const flags = defamationLint('Robert Harlan murdered her.', [subj('Robert Harlan')], NO_STATUS)
    expect(flags[0].suggestedRewrite).toBe('Robert Harlan allegedly murdered her.')
  })
})

// ─────────────── issue #45, part 1: partial-name matching ───────────────

describe('defamationLint — partial names (issue #45)', () => {
  it('blocks "Smith killed her" when the subject is stored as "John Smith"', () => {
    const flags = defamationLint('Smith killed her in the kitchen.', [subj('John Smith')], NO_STATUS)
    expect(sev(flags)).toEqual(['block'])
    expect(flags[0].subjectName).toBe('John Smith')
    expect(flags[0].reason).toContain('named here as "Smith"')
  })

  it('blocks a given-name-only mention ("John did it")', () => {
    const flags = defamationLint('John did it, and everyone knew.', [subj('John Smith')], NO_STATUS)
    expect(sev(flags)).toEqual(['block'])
  })

  it('catches the surname past a generational suffix', () => {
    const flags = defamationLint('Smith strangled her.', [subj('John Smith Jr.')], NO_STATUS)
    expect(sev(flags)).toEqual(['block'])
  })

  it('hedges the partial name in the suggested rewrite', () => {
    const flags = defamationLint('Smith killed her.', [subj('John Smith')], NO_STATUS)
    expect(flags[0].suggestedRewrite).toBe('Smith allegedly killed her.')
  })

  it('does not match a surname buried inside a longer word', () => {
    const flags = defamationLint('Smithson killed her.', [subj('John Smith')], NO_STATUS)
    expect(flags.filter((f) => f.subjectName === 'John Smith')).toEqual([])
  })

  it('does not match a lower-cased word that doubles as a name', () => {
    // "white" the colour must not read as the subject "Ava White".
    const flags = defamationLint(
      'The white van was found after he killed her.',
      [subj('Ava White')],
      NO_STATUS
    )
    expect(flags.filter((f) => f.subjectName === 'Ava White')).toEqual([])
  })

  it('applies partial matching to the deceased/review branch too', () => {
    const flags = defamationLint(
      'Smith strangled her.',
      [subj('John Smith', { living: false })],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['review'])
  })

  it('still respects the hedge on a partial-name match', () => {
    const flags = defamationLint(
      'Prosecutors say Smith killed her.',
      [subj('John Smith')],
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['warn'])
  })

  it('matches a non-ASCII surname (\\b would silently fail here)', () => {
    const flags = defamationLint('Ramírez strangled her.', [subj('José Ramírez')], NO_STATUS)
    expect(sev(flags)).toEqual(['block'])
  })

  it('does not flag the victim when she shares a surname with the accused', () => {
    // The trap: widening to surnames must not turn "Smith killed her" into a
    // hard block naming the murder VICTIM as a living, non-convicted suspect.
    const flags = defamationLint(
      'Smith killed her.',
      [subj('John Smith'), subj('Mary Smith', { role: 'victim' })],
      NO_STATUS
    )
    expect(flags).toHaveLength(1)
    expect(flags[0].subjectName).toBe('John Smith')
  })

  it('does not flag a victim described as having been murdered', () => {
    const flags = defamationLint(
      'Reed was murdered in her home in 1998.',
      [subj('Anna Reed', { role: 'victim', living: false })],
      NO_STATUS
    )
    expect(flags).toEqual([])
  })

  it('does not throw when a stored name contains regex metacharacters', () => {
    expect(() =>
      defamationLint('Smith murdered her.', [subj("Frank (Big Frank) O'Doyle")], NO_STATUS)
    ).not.toThrow()
  })
})

// ───────────── issue #45, part 2: people missing from the list ─────────────

describe('actorNames', () => {
  it('finds a name in actor position before a guilt verb', () => {
    expect(actorNames('Marcus Webb strangled her in the garage.')).toEqual(['Marcus Webb'])
  })

  it('ignores a passive victim sentence', () => {
    expect(actorNames('Sarah Fields was murdered in her home.')).toEqual([])
  })

  it('ignores pronouns and collective actors', () => {
    expect(actorNames('They murdered her that night.')).toEqual([])
    expect(actorNames('Police killed the suspect during the raid.')).toEqual([])
  })

  it('ignores places and organisations', () => {
    expect(actorNames('Harris County committed additional resources.')).toEqual([])
  })

  it('strips an honorific from the front of the name', () => {
    expect(actorNames('Detective Delgado murdered the witness.')).toEqual(['Delgado'])
  })

  it('strips calendar words the greedy match swallowed', () => {
    expect(actorNames('Last April Ramirez murdered her.')).toEqual(['Ramirez'])
  })

  it('still catches the active perfect and the copular predicate', () => {
    expect(actorNames('Ramirez had murdered before.')).toEqual(['Ramirez'])
    expect(actorNames('Ramirez was responsible for the fire.')).toEqual(['Ramirez'])
  })
})

describe('defamationLint — undeclared people (issue #45)', () => {
  const victimOnly = [subj('Anna Reed', { role: 'victim', living: false })]

  it('routes to review when a named person with a guilt verb is not a declared subject', () => {
    const flags = defamationLint('Marcus Webb strangled her in the garage.', victimOnly, NO_STATUS)
    expect(sev(flags)).toEqual(['review'])
    expect(flags[0].subjectName).toBe('Marcus Webb')
    expect(flags[0].reason).toContain("not in the script's subject list")
  })

  it('never escalates an undeclared person to block — the heuristic caps at review', () => {
    const flags = defamationLint('Marcus Webb murdered her.', [], NO_STATUS)
    expect(flags.every((f) => f.severity !== 'block')).toBe(true)
  })

  it('still routes to review when the sentence is hedged — status is unverified either way', () => {
    const flags = defamationLint(
      'Prosecutors say Marcus Webb murdered her.',
      victimOnly,
      NO_STATUS
    )
    expect(sev(flags)).toEqual(['review'])
    expect(flags[0].suggestedRewrite).toBeUndefined()
  })

  it('stays silent when the undeclared name appears without a guilt verb', () => {
    const flags = defamationLint('Marcus Webb testified for two hours.', victimOnly, NO_STATUS)
    expect(flags).toEqual([])
  })

  it('does not double-report a declared subject as undeclared (full name)', () => {
    const flags = defamationLint('John Smith killed her.', [subj('John Smith')], NO_STATUS)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
  })

  it('does not double-report a declared subject mentioned by surname only', () => {
    const flags = defamationLint('Smith killed her.', [subj('John Smith')], NO_STATUS)
    expect(flags).toHaveLength(1)
  })

  it('does not report words from the case title as an unvetted suspect', () => {
    const flags = defamationLint('Zodiac murdered five people.', [], NO_STATUS, {
      caseName: 'The Zodiac Killer',
    })
    expect(flags).toEqual([])
  })

  it('ignores a sentence-opening capital that is not a person', () => {
    const flags = defamationLint('The killer murdered her that night.', [], NO_STATUS)
    expect(flags).toEqual([])
  })

  it('reports each undeclared name once per sentence, not once per mention', () => {
    const flags = defamationLint(
      'Marcus Webb murdered her, and Marcus Webb murdered him too.',
      [],
      NO_STATUS
    )
    expect(flags).toHaveLength(1)
  })

  it('returns nothing for empty narration and an empty subject list', () => {
    expect(defamationLint('', [], NO_STATUS)).toEqual([])
  })
})
