import { cloneAgentCheckpoint, updateAgentCheckpoint } from './cache';
import type { ValidatedAgentPlan } from './policy';
import type { AgentSourceRecord } from './profile-retriever';
import type {
  AgentActionResult,
  AgentCheckpoint,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
} from './types';

export interface AgentValidatedRunPlan extends ValidatedAgentPlan {
  plan: AgentPagePlan;
}

export interface AgentExecutionReport {
  results: AgentActionResult[];
}

export interface AgentVerificationReport {
  results: AgentActionResult[];
  complete: boolean;
  needsRepair: boolean;
  failedActionIds: string[];
  canAdvance: boolean;
  reason?: string;
}

export interface AgentRuntimeDeps {
  observe(): Promise<AgentPageSnapshot>;
  retrieve(snapshot: AgentPageSnapshot): Promise<AgentSourceRecord[]>;
  plan(snapshot: AgentPageSnapshot, records: AgentSourceRecord[]): Promise<AgentPagePlan>;
  validate(
    plan: AgentPagePlan,
    snapshot: AgentPageSnapshot,
    records: AgentSourceRecord[],
  ): AgentValidatedRunPlan;
  prepare?(plan: AgentValidatedRunPlan): Promise<void>;
  execute(plan: AgentValidatedRunPlan): Promise<AgentExecutionReport>;
  verify(
    plan: AgentValidatedRunPlan,
    report: AgentExecutionReport,
    snapshot: AgentPageSnapshot,
  ): Promise<AgentVerificationReport>;
  repair?(
    plan: AgentPagePlan,
    snapshot: AgentPageSnapshot,
    records: AgentSourceRecord[],
    verification: AgentVerificationReport,
  ): Promise<AgentPagePlan>;
  save(checkpoint: AgentCheckpoint): Promise<void>;
}

export interface AgentRunOutcome {
  status: 'complete' | 'paused';
  checkpoint: AgentCheckpoint;
  canAdvance: boolean;
  reason?: string;
}

function initialCheckpoint(checkpoint?: AgentCheckpoint): AgentCheckpoint {
  return checkpoint ? cloneAgentCheckpoint(checkpoint) : {
    pageKey: '',
    phase: 'observing',
    nextActionIndex: 0,
    results: [],
    retries: {},
    manualOverrides: {},
    updatedAt: Date.now(),
  };
}

async function persist(
  deps: AgentRuntimeDeps,
  checkpoint: AgentCheckpoint,
  phase: AgentCheckpoint['phase'],
  patch: Partial<AgentCheckpoint> = {},
): Promise<AgentCheckpoint> {
  const next = updateAgentCheckpoint(checkpoint, { ...patch, phase, updatedAt: Date.now() });
  await deps.save(cloneAgentCheckpoint(next));
  return next;
}

function targetIds(action: AgentPlannedAction): string[] {
  if (action.type === 'fill_row') return action.values.map((value) => value.targetId);
  if (action.type === 'fill_field' || action.type === 'select' || action.type === 'upload') return [action.targetId];
  return [];
}

function actionComplete(action: AgentPlannedAction, results: AgentActionResult[]): boolean {
  const successful = (result: AgentActionResult) => result.status === 'verified' || result.status === 'manual';
  const ids = targetIds(action);
  if (ids.length === 0) return results.some((result) => result.actionId === action.actionId && successful(result));
  return ids.every((targetId) => results.some((result) => (
    result.actionId === action.actionId && result.targetId === targetId && successful(result)
  )));
}

function pendingValidatedPlan(
  validated: AgentValidatedRunPlan,
  results: AgentActionResult[],
): AgentValidatedRunPlan {
  return {
    ...validated,
    executableActions: validated.executableActions.filter((action) => !actionComplete(action, results)),
  };
}

function mergeResults(
  existing: AgentActionResult[],
  incoming: AgentActionResult[],
): AgentActionResult[] {
  const merged = new Map(existing.map((result) => [`${result.actionId}\u241f${result.targetId ?? ''}`, result]));
  for (const result of incoming) {
    const key = `${result.actionId}\u241f${result.targetId ?? ''}`;
    const previous = merged.get(key);
    const previousSucceeded = previous?.status === 'verified' || previous?.status === 'manual';
    const incomingSucceeded = result.status === 'verified' || result.status === 'manual';
    if (!previousSucceeded || incomingSucceeded) merged.set(key, { ...result });
  }
  return [...merged.values()];
}

function resetForPage(checkpoint: AgentCheckpoint, pageKey: string): AgentCheckpoint {
  return {
    pageKey,
    phase: 'observing',
    nextActionIndex: 0,
    results: [],
    retries: {},
    manualOverrides: {},
    updatedAt: Date.now(),
  };
}

export async function runAgentPage(
  deps: AgentRuntimeDeps,
  existingCheckpoint?: AgentCheckpoint,
): Promise<AgentRunOutcome> {
  let checkpoint = initialCheckpoint(existingCheckpoint);
  try {
    checkpoint = await persist(deps, checkpoint, 'observing');
    let snapshot = await deps.observe();
    if (checkpoint.pageKey && checkpoint.pageKey !== snapshot.pageKey) {
      checkpoint = resetForPage(checkpoint, snapshot.pageKey);
    } else {
      checkpoint.pageKey = snapshot.pageKey;
    }
    let records = await deps.retrieve(snapshot);

    if (!checkpoint.plan || checkpoint.plan.pageKey !== snapshot.pageKey) {
      checkpoint = await persist(deps, checkpoint, 'planning');
      checkpoint.plan = await deps.plan(snapshot, records);
      checkpoint.nextActionIndex = 0;
    }

    let plan = checkpoint.plan;
    checkpoint = await persist(deps, checkpoint, 'validating', { plan });
    let validated = deps.validate(plan, snapshot, records);

    for (;;) {
      const pending = pendingValidatedPlan(validated, checkpoint.results);
      if (pending.executableActions.length === 0) {
        if (validated.rejectedActionIds.length > 0) {
          const reason = 'Agent plan contains actions that require manual review';
          checkpoint = await persist(deps, checkpoint, 'paused', { error: reason });
          return { status: 'paused', checkpoint, canAdvance: false, reason };
        }
        checkpoint = await persist(deps, checkpoint, 'complete', { error: undefined });
        return { status: 'complete', checkpoint, canAdvance: true };
      }

      if (deps.prepare) {
        checkpoint = await persist(deps, checkpoint, 'preparing');
        await deps.prepare(pending);
      }
      checkpoint = await persist(deps, checkpoint, 'executing');
      const execution = await deps.execute(pending);
      checkpoint = updateAgentCheckpoint(checkpoint, {
        results: mergeResults(checkpoint.results, execution.results),
        updatedAt: Date.now(),
      });

      checkpoint = await persist(deps, checkpoint, 'verifying');
      const verification = await deps.verify(pending, execution, snapshot);
      checkpoint = updateAgentCheckpoint(checkpoint, {
        results: mergeResults(checkpoint.results, verification.results),
        updatedAt: Date.now(),
      });
      if (verification.complete) {
        checkpoint = await persist(deps, checkpoint, 'complete', { error: undefined });
        return { status: 'complete', checkpoint, canAdvance: verification.canAdvance };
      }
      if (!verification.needsRepair || verification.failedActionIds.length === 0) {
        const reason = verification.reason || 'Agent verification requires manual review';
        checkpoint = await persist(deps, checkpoint, 'paused', { error: reason });
        return { status: 'paused', checkpoint, canAdvance: false, reason };
      }

      const retries = { ...checkpoint.retries };
      for (const actionId of new Set(verification.failedActionIds)) {
        retries[actionId] = (retries[actionId] ?? 0) + 1;
      }
      checkpoint = updateAgentCheckpoint(checkpoint, { retries, updatedAt: Date.now() });
      if (verification.failedActionIds.some((actionId) => retries[actionId] > 2)) {
        const reason = verification.reason || 'Agent repair limit reached';
        checkpoint = await persist(deps, checkpoint, 'paused', { error: reason });
        return { status: 'paused', checkpoint, canAdvance: false, reason };
      }

      checkpoint = await persist(deps, checkpoint, 'repairing');
      const latestSnapshot = await deps.observe();
      if (latestSnapshot.pageKey !== snapshot.pageKey) {
        checkpoint = resetForPage(checkpoint, latestSnapshot.pageKey);
        snapshot = latestSnapshot;
        records = await deps.retrieve(snapshot);
        checkpoint = await persist(deps, checkpoint, 'planning');
        plan = await deps.plan(snapshot, records);
        checkpoint.plan = plan;
      } else if (deps.repair) {
        snapshot = latestSnapshot;
        records = await deps.retrieve(snapshot);
        plan = await deps.repair(plan, snapshot, records, verification);
        checkpoint.plan = plan;
      }
      checkpoint = await persist(deps, checkpoint, 'validating', { plan });
      validated = deps.validate(plan, snapshot, records);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Agent runtime failed';
    checkpoint = await persist(deps, checkpoint, 'paused', { error: reason });
    return { status: 'paused', checkpoint, canAdvance: false, reason };
  }
}

