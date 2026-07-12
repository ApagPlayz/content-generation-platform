import { prisma } from './prisma'
import { executeAgentRun } from './orchestrator'
import { executeTrueCrimeRun } from './truecrime/orchestrator'
import { executeHistoryRun } from './history/orchestrator'

/**
 * Dispatch an agent run to the right factory pipeline. F10 → True Crime
 * orchestrator; F11 → History/Business-story orchestrator; everything else →
 * the F9 sports orchestrator (the original default). Keeps each pipeline
 * self-contained while sharing the hub models.
 */
export async function executeRun(agentId: string): Promise<{ runId: string; videoId: string }> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { factory: { select: { type: true } } },
  })

  if (agent.factory.type === 'F10') {
    const { runId, videoId } = await executeTrueCrimeRun(agentId)
    return { runId, videoId }
  }
  if (agent.factory.type === 'F11') {
    const { runId, videoId } = await executeHistoryRun(agentId)
    return { runId, videoId }
  }
  return executeAgentRun(agentId)
}
