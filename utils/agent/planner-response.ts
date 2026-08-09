import type { AgentSourceRecord } from './profile-retriever';
import type {
  AgentFieldGroup,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
  AgentPlannedValue,
  AgentReviewItem,
  AgentTargetField,
} from './types';

export interface AgentPlanParseContext {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

export class AgentPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPlanValidationError';
  }
}

function fail(message: string): never {
  throw new AgentPlanValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(`${path} must be a non-empty string`);
  return value.trim();
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`);
  return value;
}

function finiteNumber(value: unknown, path: string, min = 0, max = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${path} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function integer(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(`${path} must be an integer >= ${min}`);
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${path} contains unknown properties: ${unknown.join(', ')}`);
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`));
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

interface TargetLocation {
  field: AgentTargetField;
  group: AgentFieldGroup;
  rowIndex?: number;
}

function targetLocations(snapshot: AgentPageSnapshot): Map<string, TargetLocation> {
  const result = new Map<string, TargetLocation>();
  for (const group of snapshot.groups) {
    for (const field of group.fields) {
      result.set(field.targetId, { field, group, rowIndex: field.rowIndex });
    }
    for (const row of group.rows) {
      for (const field of row.fields) {
        result.set(field.targetId, { field, group, rowIndex: row.rowIndex });
      }
    }
  }
  return result;
}

interface ValidationIndexes {
  targets: Map<string, TargetLocation>;
  groups: Map<string, AgentFieldGroup>;
  sources: Map<string, AgentSourceRecord>;
  fileIds: Set<string>;
  claimedTargets: Set<string>;
}

function validateEvidenceFields(
  evidenceFields: string[],
  source: AgentSourceRecord,
  path: string,
): void {
  for (const evidenceField of evidenceFields) {
    if (!(evidenceField in source.fields)) fail(`${path} references unknown evidence field: ${evidenceField}`);
  }
}

function claimTarget(targetId: string, path: string, indexes: ValidationIndexes): TargetLocation {
  const location = indexes.targets.get(targetId);
  if (!location) fail(`${path} references unknown targetId: ${targetId}`);
  if (indexes.claimedTargets.has(targetId)) fail(`${path} plans targetId more than once: ${targetId}`);
  indexes.claimedTargets.add(targetId);
  return location;
}

function sourceRecord(sourceRecordId: string, path: string, indexes: ValidationIndexes): AgentSourceRecord {
  const source = indexes.sources.get(sourceRecordId);
  if (!source) fail(`${path} references unknown sourceRecordId: ${sourceRecordId}`);
  return source;
}

function plannedValue(
  raw: unknown,
  path: string,
  source: AgentSourceRecord,
  indexes: ValidationIndexes,
): { value: AgentPlannedValue; location: TargetLocation } {
  const item = object(raw, path);
  assertExactKeys(item, ['targetId', 'value', 'evidenceFields', 'confidence', 'needsReview', 'reason'], path);
  const targetId = string(item.targetId, `${path}.targetId`);
  const location = claimTarget(targetId, path, indexes);
  const evidenceFields = stringArray(item.evidenceFields, `${path}.evidenceFields`);
  validateEvidenceFields(evidenceFields, source, `${path}.evidenceFields`);
  return {
    location,
    value: {
      targetId,
      value: string(item.value, `${path}.value`),
      evidenceFields,
      confidence: finiteNumber(item.confidence, `${path}.confidence`),
      needsReview: boolean(item.needsReview, `${path}.needsReview`),
      reason: string(item.reason, `${path}.reason`),
    },
  };
}

function parseAction(raw: unknown, path: string, indexes: ValidationIndexes): AgentPlannedAction {
  const action = object(raw, path);
  const type = string(action.type, `${path}.type`);
  const actionId = string(action.actionId, `${path}.actionId`);

  if (type === 'add_rows') {
    assertExactKeys(action, ['actionId', 'type', 'groupId', 'count', 'confidence', 'reason'], path);
    const groupId = string(action.groupId, `${path}.groupId`);
    const group = indexes.groups.get(groupId);
    if (!group) fail(`${path} references unknown groupId: ${groupId}`);
    if (group.kind !== 'repeatable') fail(`${path} can add rows only to a repeatable group`);
    return {
      actionId,
      type,
      groupId,
      count: integer(action.count, `${path}.count`, 1),
      confidence: finiteNumber(action.confidence, `${path}.confidence`),
      reason: string(action.reason, `${path}.reason`),
    };
  }

  if (type === 'fill_field' || type === 'select') {
    assertExactKeys(action, [
      'actionId', 'type', 'targetId', 'sourceRecordId', 'value', 'evidenceFields',
      'confidence', 'needsReview', 'reason',
    ], path);
    const sourceRecordId = string(action.sourceRecordId, `${path}.sourceRecordId`);
    const source = sourceRecord(sourceRecordId, path, indexes);
    const { value } = plannedValue({
      targetId: action.targetId,
      value: action.value,
      evidenceFields: action.evidenceFields,
      confidence: action.confidence,
      needsReview: action.needsReview,
      reason: action.reason,
    }, path, source, indexes);
    return { actionId, type, sourceRecordId, ...value };
  }

  if (type === 'fill_row') {
    assertExactKeys(action, ['actionId', 'type', 'groupId', 'rowIndex', 'sourceRecordId', 'values'], path);
    const groupId = string(action.groupId, `${path}.groupId`);
    const group = indexes.groups.get(groupId);
    if (!group) fail(`${path} references unknown groupId: ${groupId}`);
    if (group.kind !== 'repeatable') fail(`${path} fill_row target group is not repeatable`);
    const rowIndex = integer(action.rowIndex, `${path}.rowIndex`);
    if (!group.rows.some((row) => row.rowIndex === rowIndex)) fail(`${path} references unknown rowIndex: ${rowIndex}`);
    const sourceRecordId = string(action.sourceRecordId, `${path}.sourceRecordId`);
    const source = sourceRecord(sourceRecordId, path, indexes);
    const rawValues = array(action.values, `${path}.values`);
    if (rawValues.length === 0) fail(`${path}.values must not be empty`);
    const values = rawValues.map((rawValue, index) => {
      const parsed = plannedValue(rawValue, `${path}.values[${index}]`, source, indexes);
      if (parsed.location.group.groupId !== groupId || parsed.location.rowIndex !== rowIndex) {
        fail(`${path}.values[${index}] crosses group or row boundaries`);
      }
      return parsed.value;
    });
    return { actionId, type, groupId, rowIndex, sourceRecordId, values };
  }

  if (type === 'upload') {
    assertExactKeys(action, [
      'actionId', 'type', 'targetId', 'fileRecordId', 'confidence', 'needsReview', 'reason',
    ], path);
    const targetId = string(action.targetId, `${path}.targetId`);
    const location = claimTarget(targetId, path, indexes);
    if (location.field.kind !== 'file') fail(`${path} upload target is not a file field`);
    const fileRecordId = string(action.fileRecordId, `${path}.fileRecordId`);
    if (!indexes.fileIds.has(fileRecordId)) fail(`${path} references unknown fileRecordId: ${fileRecordId}`);
    if (boolean(action.needsReview, `${path}.needsReview`) !== true) fail(`${path}.needsReview must be true for uploads`);
    return {
      actionId,
      type,
      targetId,
      fileRecordId,
      confidence: finiteNumber(action.confidence, `${path}.confidence`),
      needsReview: true,
      reason: string(action.reason, `${path}.reason`),
    };
  }

  fail(`${path} has unsupported action type: ${type}`);
}

function parseReviewItem(
  raw: unknown,
  path: string,
  indexes: ValidationIndexes,
  actionIds: Set<string>,
): AgentReviewItem {
  const item = object(raw, path);
  assertExactKeys(item, ['reviewId', 'targetId', 'actionId', 'message'], path);
  const reviewId = string(item.reviewId, `${path}.reviewId`);
  const targetId = item.targetId == null ? undefined : string(item.targetId, `${path}.targetId`);
  const actionId = item.actionId == null ? undefined : string(item.actionId, `${path}.actionId`);
  if (targetId && !indexes.targets.has(targetId)) fail(`${path} references unknown targetId: ${targetId}`);
  if (actionId && !actionIds.has(actionId)) fail(`${path} references unknown actionId: ${actionId}`);
  return { reviewId, targetId, actionId, message: string(item.message, `${path}.message`) };
}

export function parseAgentPagePlan(text: string, context: AgentPlanParseContext): AgentPagePlan {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(text));
  } catch (error) {
    fail(`Agent plan is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  const plan = object(raw, 'plan');
  assertExactKeys(plan, [
    'version', 'pageKey', 'snapshotFingerprint', 'profileFingerprint', 'actions', 'reviewItems',
  ], 'plan');
  if (plan.version !== 1) fail('plan.version must equal 1');
  const pageKey = string(plan.pageKey, 'plan.pageKey');
  if (pageKey !== context.snapshot.pageKey) fail('plan.pageKey does not match the observed page');

  const indexes: ValidationIndexes = {
    targets: targetLocations(context.snapshot),
    groups: new Map(context.snapshot.groups.map((group) => [group.groupId, group])),
    sources: new Map(context.sourceRecords.map((record) => [record.recordId, record])),
    fileIds: new Set(context.fileRecordIds ?? []),
    claimedTargets: new Set(),
  };
  const actionIds = new Set<string>();
  const actions = array(plan.actions, 'plan.actions').map((rawAction, index) => {
    const action = parseAction(rawAction, `plan.actions[${index}]`, indexes);
    if (actionIds.has(action.actionId)) fail(`plan.actions has duplicate actionId: ${action.actionId}`);
    actionIds.add(action.actionId);
    return action;
  });
  const reviewIds = new Set<string>();
  const reviewItems = array(plan.reviewItems, 'plan.reviewItems').map((rawItem, index) => {
    const item = parseReviewItem(rawItem, `plan.reviewItems[${index}]`, indexes, actionIds);
    if (reviewIds.has(item.reviewId)) fail(`plan.reviewItems has duplicate reviewId: ${item.reviewId}`);
    reviewIds.add(item.reviewId);
    return item;
  });

  return {
    version: 1,
    pageKey,
    snapshotFingerprint: string(plan.snapshotFingerprint, 'plan.snapshotFingerprint'),
    profileFingerprint: string(plan.profileFingerprint, 'plan.profileFingerprint'),
    actions,
    reviewItems,
  };
}
