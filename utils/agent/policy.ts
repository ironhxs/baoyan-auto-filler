import type { AgentSourceRecord } from './profile-retriever';
import type {
  AgentFieldRow,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
  AgentPlannedValue,
  AgentReviewItem,
  AgentTargetField,
} from './types';

export type AgentFieldStatusName = 'empty' | 'planned' | 'verified' | 'manual' | 'review' | 'failed';

export interface AgentFieldStatus {
  status: AgentFieldStatusName;
  marker: 'none' | 'verified' | 'manual' | 'review' | 'failed';
  canOverwrite: boolean;
  observedValue: string;
  plannedValue: string;
}

export interface AgentRowStatus {
  status: 'empty' | 'partial' | 'complete' | 'conflict';
  marker: 'none' | 'verified' | 'manual' | 'review' | 'failed';
  blocksAdvance: boolean;
  populated: number;
  total: number;
  missingTargetIds: string[];
}

export interface ValidateAgentPlanContext {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  observedValues: Record<string, string>;
  lastAgentValues: Record<string, string>;
}

export interface ValidatedAgentPlan {
  executableActions: AgentPlannedAction[];
  reviewItems: AgentReviewItem[];
  manualTargets: string[];
  rejectedActionIds: string[];
}

function normalized(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function deriveAgentFieldStatus(
  field: AgentTargetField,
  plannedValue: string | undefined,
  observedValue: string | undefined,
  lastAgentValue: string | undefined,
): AgentFieldStatus {
  const planned = normalized(plannedValue);
  const observed = normalized(observedValue);
  const previous = normalized(lastAgentValue);

  if (field.protected) {
    return { status: 'review', marker: 'review', canOverwrite: false, observedValue: observed, plannedValue: planned };
  }
  if (observed) {
    if (planned && observed === planned) {
      return { status: 'verified', marker: 'verified', canOverwrite: true, observedValue: observed, plannedValue: planned };
    }
    if (previous && observed === previous) {
      return { status: 'verified', marker: 'verified', canOverwrite: true, observedValue: observed, plannedValue: planned };
    }
    return { status: 'manual', marker: 'manual', canOverwrite: false, observedValue: observed, plannedValue: planned };
  }
  if (planned) {
    return { status: 'planned', marker: 'review', canOverwrite: true, observedValue: '', plannedValue: planned };
  }
  return { status: 'empty', marker: 'none', canOverwrite: true, observedValue: '', plannedValue: '' };
}

export function deriveAgentRowStatus(
  row: AgentFieldRow,
  plannedValues: Record<string, string>,
  observedValues: Record<string, string>,
): AgentRowStatus {
  const usableFields = row.fields.filter((field) => !field.protected);
  const values = usableFields.map((field) => normalized(observedValues[field.targetId] || plannedValues[field.targetId]));
  const populated = values.filter(Boolean).length;
  const missingTargetIds = usableFields
    .filter((_, index) => !values[index])
    .map((field) => field.targetId);
  if (populated === 0) {
    return {
      status: 'empty', marker: 'none', blocksAdvance: false,
      populated, total: usableFields.length, missingTargetIds,
    };
  }
  if (populated < usableFields.length) {
    return {
      status: 'partial', marker: 'review', blocksAdvance: true,
      populated, total: usableFields.length, missingTargetIds,
    };
  }
  return {
    status: 'complete', marker: 'verified', blocksAdvance: false,
    populated, total: usableFields.length, missingTargetIds: [],
  };
}

interface TargetLocation {
  field: AgentTargetField;
  groupId: string;
  rowIndex?: number;
}

function targetIndex(snapshot: AgentPageSnapshot): Map<string, TargetLocation> {
  const result = new Map<string, TargetLocation>();
  for (const group of snapshot.groups) {
    for (const field of group.fields) {
      result.set(field.targetId, { field, groupId: group.groupId, rowIndex: field.rowIndex });
    }
    for (const row of group.rows) {
      for (const field of row.fields) {
        result.set(field.targetId, { field, groupId: group.groupId, rowIndex: row.rowIndex });
      }
    }
  }
  return result;
}

function normalizeDateForField(value: string, field: AgentTargetField): string | null {
  const expectsYearMonth = field.formatHints.some((hint) => /\d{4}-\d{1,2}|yyyy-mm/i.test(hint));
  if (!expectsYearMonth) return value;
  const match = value.match(/(\d{4})\D{0,3}(\d{1,2})(?:\D|$)/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

function normalizePlannedValue(value: AgentPlannedValue, field: AgentTargetField): string | null {
  let result = normalized(value.value);
  for (const character of field.forbiddenCharacters) result = result.split(character).join('');
  result = normalized(result);
  const dateValue = normalizeDateForField(result, field);
  if (dateValue == null) return null;
  result = dateValue;
  if (!result) return null;
  if (field.maxLength != null && field.maxLength >= 0 && result.length > field.maxLength) return null;
  if (field.options.length > 0 && !field.options.includes(result)) return null;
  return result;
}

function actionValues(action: AgentPlannedAction): AgentPlannedValue[] {
  if (action.type === 'fill_row') return action.values;
  if (action.type === 'fill_field' || action.type === 'select') return [action];
  return [];
}

function reviewItem(actionId: string, targetId: string | undefined, message: string): AgentReviewItem {
  return {
    reviewId: `policy:${actionId}:${targetId ?? 'action'}`,
    actionId,
    targetId,
    message,
  };
}

export function validateAgentPlan(
  plan: AgentPagePlan,
  context: ValidateAgentPlanContext,
): ValidatedAgentPlan {
  const targets = targetIndex(context.snapshot);
  const sources = new Map(context.sourceRecords.map((record) => [record.recordId, record]));
  const executableActions: AgentPlannedAction[] = [];
  const reviewItems: AgentReviewItem[] = [...plan.reviewItems];
  const manualTargets = new Set<string>();
  const rejectedActionIds: string[] = [];

  for (const action of plan.actions) {
    if (action.type === 'add_rows' || action.type === 'upload') {
      executableActions.push(action);
      continue;
    }

    const source = sources.get(action.sourceRecordId);
    const values = actionValues(action);
    let rejected = !source;
    const normalizedValues: AgentPlannedValue[] = [];

    if (!source) reviewItems.push(reviewItem(action.actionId, undefined, '计划引用的资料记录不存在'));
    for (const value of values) {
      const location = targets.get(value.targetId);
      if (!location) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, value.targetId, '计划引用的网页字段不存在'));
        continue;
      }
      if (action.type === 'fill_row'
        && (location.groupId !== action.groupId || location.rowIndex !== action.rowIndex)) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, value.targetId, '整行计划跨越了其他行或分组'));
        continue;
      }
      if (!source || value.evidenceFields.length === 0
        || value.evidenceFields.some((key) => !(key in source.fields))) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, value.targetId, '缺少可核对的资料证据'));
        continue;
      }
      const normalizedValue = normalizePlannedValue(value, location.field);
      if (normalizedValue == null) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, value.targetId, '计划值不符合网页格式、选项或长度限制'));
        continue;
      }
      const fieldStatus = deriveAgentFieldStatus(
        location.field,
        normalizedValue,
        context.observedValues[value.targetId],
        context.lastAgentValues[value.targetId],
      );
      if (!fieldStatus.canOverwrite) {
        rejected = true;
        if (fieldStatus.status === 'manual') manualTargets.add(value.targetId);
        reviewItems.push(reviewItem(action.actionId, value.targetId, '保留网页上的人工值，不自动覆盖'));
        continue;
      }
      normalizedValues.push({ ...value, value: normalizedValue });
      if (value.needsReview) {
        reviewItems.push(reviewItem(action.actionId, value.targetId, value.reason || '模型建议重点复核'));
      }
    }

    if (action.type === 'fill_row') {
      const group = context.snapshot.groups.find((item) => item.groupId === action.groupId);
      const row = group?.rows.find((item) => item.rowIndex === action.rowIndex);
      const expectedTargetIds = row?.fields.filter((field) => !field.protected).map((field) => field.targetId) ?? [];
      const plannedTargetIds = new Set(values.map((value) => value.targetId));
      const missingColumns = expectedTargetIds.filter((targetId) => !plannedTargetIds.has(targetId));
      if (missingColumns.length > 0) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, undefined, `整行计划缺少 ${missingColumns.length} 个列值`));
      }
    }

    if (rejected || normalizedValues.length !== values.length) {
      rejectedActionIds.push(action.actionId);
      continue;
    }
    if (action.type === 'fill_row') executableActions.push({ ...action, values: normalizedValues });
    else executableActions.push({ ...action, ...normalizedValues[0] });
  }

  return {
    executableActions,
    reviewItems,
    manualTargets: [...manualTargets],
    rejectedActionIds,
  };
}

export interface CanAgentAdvanceInput {
  snapshot: AgentPageSnapshot;
  nextActionLabel: string;
  fieldStatuses: Record<string, AgentFieldStatusName>;
  rowStatuses: AgentRowStatus[];
}

const DANGEROUS_NAVIGATION = /最终提交|提交申请|确认报名|确认提交|承诺书|选择导师|导师选择|选择志愿|志愿选择|支付|缴费|删除|验证码|完成报名/;

export function canAgentAdvance(input: CanAgentAdvanceInput): boolean {
  if (DANGEROUS_NAVIGATION.test(normalized(input.nextActionLabel))) return false;
  if (input.rowStatuses.some((status) => status.blocksAdvance || status.status === 'conflict')) return false;
  for (const group of input.snapshot.groups) {
    for (const field of group.fields) {
      if (!field.required || field.protected) continue;
      const status = input.fieldStatuses[field.targetId] ?? 'empty';
      if (status !== 'verified' && status !== 'manual') return false;
    }
  }
  return /下一步|继续|保存并继续|保存并下一步/.test(normalized(input.nextActionLabel));
}

