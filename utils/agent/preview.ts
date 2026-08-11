import type { MatchResult } from '../matcher';
import { buildAgentExecutionBatch } from './executor';
import { blockingAgentReviewItems, validateAgentPlan } from './policy';
import type { AgentSourceRecord } from './profile-retriever';
import type {
  AgentActionResult,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
} from './types';

export interface BuildAgentPreviewInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  plan: AgentPagePlan;
  fileRecordIds?: string[];
  lastAgentValues?: Record<string, string>;
}

export interface AgentPreviewResult {
  plan: AgentPagePlan;
  matches: MatchResult[];
  pendingStructureActions: AgentPlannedAction[];
  reviewItems: AgentPagePlan['reviewItems'];
  rejectedActionIds: string[];
}

function fieldByTarget(snapshot: AgentPageSnapshot): Map<string, AgentPageSnapshot['groups'][number]['fields'][number]> {
  const fields = snapshot.groups.flatMap((group) => [
    ...group.fields,
    ...group.rows.flatMap((row) => row.fields),
  ]);
  return new Map(fields.map((field) => [field.targetId, field]));
}

function observedValues(snapshot: AgentPageSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.groups.flatMap((group) => [
    ...group.fields,
    ...group.rows.flatMap((row) => row.fields),
  ]).map((field) => [field.targetId, field.currentValue]));
}

export function buildAgentPreview(input: BuildAgentPreviewInput): AgentPreviewResult {
  const validated = validateAgentPlan(input.plan, {
    snapshot: input.snapshot,
    sourceRecords: input.sourceRecords,
    observedValues: observedValues(input.snapshot),
    lastAgentValues: input.lastAgentValues ?? {},
  });
  const executablePlan: AgentPagePlan = {
    ...input.plan,
    actions: validated.executableActions,
    reviewItems: validated.reviewItems,
  };
  const batch = buildAgentExecutionBatch(executablePlan, input.snapshot);
  const fields = fieldByTarget(input.snapshot);
  const matches = batch.items.flatMap<MatchResult>((item) => {
    const field = fields.get(item.targetId);
    if (!field) return [];
    return [{
      kind: 'text',
      index: item.index,
      fieldKey: item.sourceRecordId,
      value: item.value,
      shortLabel: field.label,
      confidence: item.confidence,
      fillMode: item.value.length >= 80 ? 'long' : 'short',
      source: 'ai_reviewed',
    }];
  });
  return {
    plan: executablePlan,
    matches,
    pendingStructureActions: [...batch.addRows, ...batch.uploads],
    reviewItems: validated.reviewItems,
    rejectedActionIds: validated.rejectedActionIds,
  };
}
