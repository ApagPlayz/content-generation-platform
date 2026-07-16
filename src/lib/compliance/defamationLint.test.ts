// Unit tests for the defamation lint (src/lib/compliance/defamationLint.ts) — the
// single deterministic backstop that keeps an autonomous true-crime agent from
// publishing a sentence that flatly states a living, non-convicted real person
// committed the crime. This is the highest-stakes code in the repo (it's what
// keeps the channel out of court) and it previously had zero tests, so a refactor
// could disable it with a green build. These cases lock the contract:
//   - a stored subject is caught by full name AND by surname/first-name only
//   - a person named with a guilt verb who ISN'T in the subject list routes to
//     review instead of silently passing
//   - convicted/guilt-assertable people can still be named; hedged language warns
//   - the false-positive guards (lowercase words, sentence-initial capitals,
//     titles like "Detective", ambiguous common-word names) hold. (Issue #45.)

import { describe, expect, it } from 'vitest'
import { defamationLint } from './defamationLint'
import type { CaseSubject, LegalStatus, LegalStatusResult } from './types'

function subject(name: string, o: Partial<CaseSubject> = {}): CaseSubject {
  return {
    name,
    role: o.role ?? 'accused',
    living: o.living ?? true,
    isMinor: o.isMinor ?? false,
  }
}

function status(name: string, guiltAssertable: boolean, s: LegalStatus = 'charged_pending'): LegalStatusResult {
  return { name, status: s, evidence: [], guiltAssertable, notes: '' }
}

const JOHN = subject('John Smith') // living, accused, guilt not assertable
const notAssertable = [status('John Smith', false)]

describe('defamationLint — stored subject matching', () => {
  it('blocks a full-name guilt assertion about a living, non-convicted person', () => {
    const flags = defamationLint('John Smith murdered the clerk.', [JOHN], notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
    expect(flags[0].subjectName).toBe('John Smith')
    expect(flags[0].suggestedRewrite).toContain('allegedly')
  })

  it('blocks a SURNAME-only mention (the core fix — passed silently before)', () => {
    const flags = defamationLint('Smith murdered the clerk.', [JOHN], notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
    expect(flags[0].subjectName).toBe('John Smith')
    // the rewrite hedges the surface term that actually appeared
    expect(flags[0].suggestedRewrite).toContain('Smith allegedly')
  })

  it('blocks a FIRST-name-only mention', () => {
    const flags = defamationLint('John strangled her that night.', [JOHN], notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
    expect(flags[0].subjectName).toBe('John Smith')
  })

  it('warns (does not block) when the guilt language is hedged', () => {
    const flags = defamationLint('Smith allegedly murdered the clerk.', [JOHN], notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('warn')
  })

  it('does NOT flag a convicted / guilt-assertable person', () => {
    const flags = defamationLint('Smith murdered the clerk.', [JOHN], [
      status('John Smith', true, 'convicted'),
    ])
    expect(flags).toEqual([])
  })

  it('routes a deceased, unadjudicated subject to review', () => {
    const dead = [subject('John Smith', { living: false })]
    const flags = defamationLint('John Smith poisoned them.', dead, notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('review')
  })

  it('does not flag a sentence with no guilt verb', () => {
    const flags = defamationLint('John Smith grew up in Ohio.', [JOHN], notAssertable)
    expect(flags).toEqual([])
  })
})

describe('defamationLint — unknown named person', () => {
  it('routes a guilt assertion about someone NOT in the subject list to review', () => {
    const flags = defamationLint('Reyes strangled the victim that night.', [], [])
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('review')
    expect(flags[0].subjectName).toBe('Reyes')
  })

  it('catches an unknown accused named as the passive agent ("... by Durst")', () => {
    const flags = defamationLint('The clerk was murdered by Durst.', [], [])
    expect(flags.some((f) => f.severity === 'review' && f.subjectName === 'Durst')).toBe(true)
  })

  it('does not fire on a hedged sentence about an unknown person', () => {
    const flags = defamationLint('Reyes allegedly strangled the victim.', [], [])
    expect(flags).toEqual([])
  })

  it('flags a co-perpetrator not in the list while blocking the listed subject', () => {
    const flags = defamationLint('John Smith and Robert Durst killed the couple.', [JOHN], notAssertable)
    expect(flags.some((f) => f.severity === 'block' && f.subjectName === 'John Smith')).toBe(true)
    expect(flags.some((f) => f.severity === 'review' && f.subjectName === 'Robert Durst')).toBe(true)
  })

  it('ignores a leading title word and flags only the real name', () => {
    const flags = defamationLint('Detective Cole murdered the suspect.', [], [])
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('review')
    expect(flags[0].subjectName).toBe('Cole')
  })
})

describe('defamationLint — false-positive guards', () => {
  it('does not treat a lowercase common word as a name', () => {
    const flags = defamationLint('The old john overflowed and killed the mood.', [JOHN], notAssertable)
    expect(flags).toEqual([])
  })

  it('does not flag a title/role word standing in for a person', () => {
    const flags = defamationLint('Police killed the investigation that day.', [], [])
    expect(flags).toEqual([])
  })

  it('does not read a sentence-initial ambiguous name-word as the subject', () => {
    const will = [subject('Will Grayson')]
    const flags = defamationLint('Will the jury decide who killed her?', will, [status('Will Grayson', false)])
    // "Will" here is the modal verb, not the subject — and "who killed her" is a
    // question, not an assertion about a named person.
    expect(flags.filter((f) => f.subjectName === 'Will Grayson')).toEqual([])
  })

  it('still catches the same subject by surname when it really is named', () => {
    const will = [subject('Will Grayson')]
    const flags = defamationLint('Grayson killed her.', will, [status('Will Grayson', false)])
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
    expect(flags[0].subjectName).toBe('Will Grayson')
  })

  it('keeps the "real killer" speculation route-to-review path working', () => {
    const flags = defamationLint('Everyone still wonders who really did it.', [], [])
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('review')
  })

  it('isolates flags per sentence — a clean follow-up sentence adds nothing', () => {
    const flags = defamationLint('John Smith murdered the clerk. He was later seen in Reno.', [JOHN], notAssertable)
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('block')
  })
})
