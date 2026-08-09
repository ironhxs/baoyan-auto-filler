import type { AgentExecutionResult } from './executor';
import { deriveAgentRowStatus } from './policy';
import type { AgentFieldStatusName, AgentRowStatus } from './policy';
import type { AgentPagePlan, AgentPageSnapshot, AgentPlannedValue } from './types';
import { isPageValueConsistent } from '../value-compare';

export interface VerifyAgentExecutionInput {
  plan: AgentPagePlan;
  snapshot: AgentPageSnapshot;
  beforeValues: Record<string, string>;
  afterValues: Record<string, string>;
  lastAgentValues: Record<string, string>;
  executionResults?: AgentExecutionResult[];
}

export interface AgentVerificationSummary {
  fieldStatuses: Record<string, AgentFieldStatusName>;
  rowStatuses: AgentRowStatus[];
  retryableTargetIds: string[];
  verified: number;
  manual: number;
  failed: number;
}

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function plannedValues(plan: AgentPagePlan): Map<string, AgentPlannedValue> {
  const result = new Map<string, AgentPlannedValue>();
  for (const action of plan.actions) {
    if (action.type === 'fill_row') {
      for (const value of action.values) result.set(value.targetId, value);
    } else if (action.type === 'fill_field' || action.type === 'select') {
      result.set(action.targetId, action);
    }
  }
  return result;
}

export function verifyAgentExecution(input: VerifyAgentExecutionInput): AgentVerificationSummary {
  const expected = plannedValues(input.plan);
  const resultByTarget = new Map((input.executionResults ?? []).map((result) => [result.targetId, result]));
  const fieldStatuses: Record<string, AgentFieldStatusName> = {};
  const retryableTargetIds: string[] = [];

  for (const [targetId, planned] of expected) {
    const expectedValue = normalize(planned.value);
    const before = normalize(input.beforeValues[targetId]);
    const after = normalize(input.afterValues[targetId]);
    const previous = normalize(input.lastAgentValues[targetId]);
    const execution = resultByTarget.get(targetId);

    if (execution && !execution.attempted) {
      fieldStatuses[targetId] = 'failed';
      if (/target-not-found|page-changed|stale-target/.test(execution.reason)) retryableTargetIds.push(targetId);
      continue;
    }
    if (expectedValue && isPageValueConsistent(after, expectedValue)) {
      fieldStatuses[targetId] = 'verified';
      continue;
    }
    const preservedManualValue = before
      && isPageValueConsistent(after, before)
      && !isPageValueConsistent(before, expectedValue)
      && (!previous || !isPageValueConsistent(before, previous));
    if (preservedManualValue) {
      fieldStatuses[targetId] = 'manual';
      continue;
    }
    fieldStatuses[targetId] = execution?.matched ? 'review' : 'failed';
  }

  const rowStatuses = input.snapshot.groups.flatMap((group) => group.rows
    .filter((row) => row.fields.some((field) => expected.has(field.targetId)))
    .map((row) => deriveAgentRowStatus(row, {}, input.afterValues)));
  const statuses = Object.values(fieldStatuses);
  return {
    fieldStatuses,
    rowStatuses,
    retryableTargetIds: [...new Set(retryableTargetIds)],
    verified: statuses.filter((status) => status === 'verified').length,
    manual: statuses.filter((status) => status === 'manual').length,
    failed: statuses.filter((status) => status === 'failed').length,
  };
}
