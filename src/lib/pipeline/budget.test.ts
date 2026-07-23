// Unit tests for the shared per-run budget gate (src/lib/pipeline/budget.ts).
// Issue #26: Agent.budget must actually abort a run once accumulated cost hits
// the cap. The decision logic lives in pure helpers (the DB read is a thin
// wrapper), so it gets tested here in isolation — mirroring the repo's
// colocated pure-function test style (see finalize.test.ts).

import { describe, expect, it } from 'vitest'
import {
  isOverBudget,
  formatUsd,
  budgetStopReason,
  BudgetExceededError,
} from './budget'

describe('isOverBudget', () => {
  it('is true when spend has passed the cap', () => {
    expect(isOverBudget(6.2, 5)).toBe(true)
  })

  it('is true at the exact cap — the cap is a ceiling that has been hit', () => {
    expect(isOverBudget(5, 5)).toBe(true)
  })

  it('is false while spend is still under the cap', () => {
    expect(isOverBudget(4.99, 5)).toBe(false)
    expect(isOverBudget(0, 5)).toBe(false)
  })

  it('treats a missing cap as "no cap" (never stops a run)', () => {
    expect(isOverBudget(1000, null)).toBe(false)
    expect(isOverBudget(1000, undefined)).toBe(false)
  })

  it('treats a zero or negative cap as "no cap" so agents are not bricked', () => {
    expect(isOverBudget(1000, 0)).toBe(false)
    expect(isOverBudget(1000, -1)).toBe(false)
  })

  it('treats a non-finite cap as "no cap"', () => {
    expect(isOverBudget(1000, NaN)).toBe(false)
  })

  it('trips on a tiny sub-cent cap, at and above the boundary', () => {
    expect(isOverBudget(0.002, 0.001)).toBe(true)
    expect(isOverBudget(0.001, 0.001)).toBe(true)
    expect(isOverBudget(0.0005, 0.001)).toBe(false)
  })
})

describe('formatUsd', () => {
  it('shows two decimals for normal amounts', () => {
    expect(formatUsd(5)).toBe('$5.00')
    expect(formatUsd(12.5)).toBe('$12.50')
  })

  it('keeps a plain zero at two decimals', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('keeps sub-cent amounts legible instead of collapsing to $0.00', () => {
    expect(formatUsd(0.001)).toBe('$0.001')
    expect(formatUsd(0.005)).toBe('$0.005')
  })
})

describe('budgetStopReason', () => {
  it('is a plain-English message naming the cap', () => {
    expect(budgetStopReason(5)).toBe('Stopped: run hit your $5.00 budget cap')
    expect(budgetStopReason(5)).toMatch(/budget cap/i)
  })

  it('renders a tiny test cap sensibly', () => {
    expect(budgetStopReason(0.001)).toBe('Stopped: run hit your $0.001 budget cap')
  })
})

describe('BudgetExceededError', () => {
  it('is a real Error that carries the spend and the cap', () => {
    const err = new BudgetExceededError(6.2, 5)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(BudgetExceededError)
    expect(err.name).toBe('BudgetExceededError')
    expect(err.spent).toBe(6.2)
    expect(err.budget).toBe(5)
  })

  it('uses the owner-facing stop reason as its message', () => {
    const err = new BudgetExceededError(6.2, 5)
    expect(err.message).toBe(budgetStopReason(5))
  })
})
