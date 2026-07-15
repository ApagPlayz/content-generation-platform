// Shared "have we spent too much on this run?" gate for every pipeline
// (Sports, True Crime, History).
//
// Agent.budget is collected on the "New Agent" form, where the UI promises the
// orchestrator "will abort the run if Claude + media costs exceed this amount"
// — but no runtime code ever read it, so the cap did nothing. These helpers
// make that promise real: before each pipeline stage runs, the orchestrator
// sums this run's CostLedger spend and aborts if it has reached the cap.
//
// See issue #26: "make the budget limit real".

import { prisma } from '../prisma'

/**
 * Thrown when a run's accumulated cost has reached the agent's budget cap. A
 * distinct type so the orchestrator (and any future caller/UI) can tell a
 * deliberate budget stop apart from a genuine crash — and, crucially, skip
 * retrying it.
 */
export class BudgetExceededError extends Error {
  readonly spent: number
  readonly budget: number
  constructor(spent: number, budget: number) {
    super(budgetStopReason(budget))
    this.name = 'BudgetExceededError'
    this.spent = spent
    this.budget = budget
  }
}

/**
 * True only when a real positive cap is set AND spend has reached it. A missing
 * cap (null/undefined) or a non-positive cap (0/negative) means "no cap" and
 * never stops a run: the create-agent form stores null for an empty field, so
 * treating 0 as "block everything" would silently brick every agent.
 */
export function isOverBudget(spent: number, budget: number | null | undefined): boolean {
  if (typeof budget !== 'number' || !(budget > 0)) return false
  return spent >= budget
}

/**
 * Format a USD amount for owner-facing text, keeping sub-cent caps legible — a
 * $0.001 test cap must not silently render as "$0.00".
 */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return `$${Number(n.toPrecision(2))}`
  return `$${n.toFixed(2)}`
}

/** Plain-English reason shown to the owner when a run hits its budget cap. */
export function budgetStopReason(budget: number): string {
  return `Stopped: run hit your ${formatUsd(budget)} budget cap`
}

/** Sum of every CostLedger row for a video (0 when nothing recorded yet). This
 *  is the same aggregate the orchestrators already use in finalizeCost. */
export async function spentSoFar(videoId: string): Promise<number> {
  const ledger = await prisma.costLedger.aggregate({
    where: { videoId },
    _sum: { total: true },
  })
  return ledger._sum.total ?? 0
}

/**
 * Guard every pipeline stage calls the moment its Job row is created, before
 * doing any (further paid) work: if this run's accumulated spend has reached
 * the cap, mark the stage's Job failed with the plain-English reason — so it
 * shows in the Queue UI — and throw BudgetExceededError so the orchestrator's
 * catch aborts the whole run. A no-op (and no DB read) when no cap is set, so
 * runs for agents without a budget behave exactly as before.
 */
export async function enforceStageBudget(
  videoId: string,
  budget: number | null | undefined,
  jobId: string
): Promise<void> {
  if (budget == null) return
  const spent = await spentSoFar(videoId)
  if (!isOverBudget(spent, budget)) return
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'failed', error: budgetStopReason(budget), finishedAt: new Date() },
  })
  throw new BudgetExceededError(spent, budget)
}
