import type { AgentCheckpoint } from './types';

export type AgentControlCommand = 'retry_failed' | 'replan_page';

function keepDurableResult(result: AgentCheckpoint['results'][number]): boolean {
  return result.status === 'verified' || result.status === 'manual' || result.status === 'skipped';
}

export function applyAgentControl(
  checkpoint: AgentCheckpoint,
  command: AgentControlCommand,
  now = Date.now(),
): AgentCheckpoint {
  const results = checkpoint.results.filter(keepDurableResult).map((result) => ({ ...result }));
  if (command === 'replan_page') {
    return {
      ...checkpoint,
      phase: 'observing',
      plan: undefined,
      snapshotFingerprint: undefined,
      profileFingerprint: undefined,
      nextActionIndex: 0,
      results,
      retries: {},
      error: undefined,
      cached: false,
      manualOverrides: { ...checkpoint.manualOverrides },
      updatedAt: now,
    };
  }

  const failedActionIds = new Set(checkpoint.results
    .filter((result) => result.status === 'failed' || result.status === 'review')
    .map((result) => result.actionId));
  return {
    ...checkpoint,
    phase: 'observing',
    nextActionIndex: 0,
    results,
    retries: Object.fromEntries(Object.entries(checkpoint.retries)
      .map(([actionId, count]) => [actionId, failedActionIds.has(actionId) ? 0 : count])),
    error: undefined,
    manualOverrides: { ...checkpoint.manualOverrides },
    updatedAt: now,
  };
}
