import type {
  AgentAddRowsAction,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedValue,
  AgentTargetField,
  AgentUploadAction,
} from './types';

export interface AgentExecutionItem {
  actionId: string;
  targetId: string;
  index: number;
  value: string;
  confidence: 'high' | 'medium';
  sourceRecordId: string;
  rowIndex?: number;
  expectedCurrentValue: string;
}

export interface AgentExecutionResult {
  actionId: string;
  targetId: string;
  attempted: boolean;
  observed: string;
  matched: boolean;
  reason: string;
}

export interface AgentExecutionBatch {
  pageKey: string;
  items: AgentExecutionItem[];
  addRows: AgentAddRowsAction[];
  uploads: AgentUploadAction[];
  missingTargetIds: string[];
  blockedTargetIds: string[];
  safeToExecute: boolean;
}

interface TargetLocation {
  field: AgentTargetField;
  order: number;
}

function targetsInPageOrder(snapshot: AgentPageSnapshot): Map<string, TargetLocation> {
  const targets = new Map<string, TargetLocation>();
  let order = 0;
  for (const group of snapshot.groups) {
    if (group.rows.length > 0) {
      for (const row of group.rows) {
        for (const column of group.columns) {
          const field = row.fields.find((candidate) => candidate.columnId === column.columnId);
          if (field && !targets.has(field.targetId)) targets.set(field.targetId, { field, order: order++ });
        }
        for (const field of row.fields) {
          if (!targets.has(field.targetId)) targets.set(field.targetId, { field, order: order++ });
        }
      }
    }
    for (const field of group.fields) {
      if (!targets.has(field.targetId)) targets.set(field.targetId, { field, order: order++ });
    }
  }
  return targets;
}

function executionItem(
  actionId: string,
  sourceRecordId: string,
  value: AgentPlannedValue,
  field: AgentTargetField,
): AgentExecutionItem {
  return {
    actionId,
    targetId: value.targetId,
    index: field.index,
    value: value.value,
    confidence: value.confidence >= 0.9 && !value.needsReview ? 'high' : 'medium',
    sourceRecordId,
    rowIndex: field.rowIndex,
    expectedCurrentValue: field.currentValue,
  };
}

export function buildAgentExecutionBatch(
  plan: AgentPagePlan,
  latestSnapshot: AgentPageSnapshot,
): AgentExecutionBatch {
  if (plan.pageKey !== latestSnapshot.pageKey) {
    throw new Error(`Agent plan pageKey ${plan.pageKey} does not match current pageKey ${latestSnapshot.pageKey}`);
  }
  const targets = targetsInPageOrder(latestSnapshot);
  const items: Array<AgentExecutionItem & { order: number }> = [];
  const missingTargetIds: string[] = [];
  const blockedTargetIds: string[] = [];
  const addRows: AgentAddRowsAction[] = [];
  const uploads: AgentUploadAction[] = [];

  for (const action of plan.actions) {
    if (action.type === 'add_rows') {
      addRows.push(action);
      continue;
    }
    if (action.type === 'upload') {
      uploads.push(action);
      continue;
    }
    const values = action.type === 'fill_row' ? action.values : [action];
    for (const value of values) {
      const location = targets.get(value.targetId);
      if (!location) {
        missingTargetIds.push(value.targetId);
        continue;
      }
      if (location.field.protected) {
        blockedTargetIds.push(value.targetId);
        continue;
      }
      items.push({
        ...executionItem(action.actionId, action.sourceRecordId, value, location.field),
        order: location.order,
      });
    }
  }

  items.sort((left, right) => left.order - right.order);
  return {
    pageKey: latestSnapshot.pageKey,
    items: items.map(({ order: _order, ...item }) => item),
    addRows,
    uploads,
    missingTargetIds: [...new Set(missingTargetIds)],
    blockedTargetIds: [...new Set(blockedTargetIds)],
    safeToExecute: missingTargetIds.length === 0 && blockedTargetIds.length === 0,
  };
}

