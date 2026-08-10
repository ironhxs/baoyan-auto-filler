import type { AgentSourceRecord } from './profile-retriever';
import { isPageValueConsistent } from '../value-compare';
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

function isOptionalRepeatField(field: AgentTargetField): boolean {
  if (field.required) return false;
  const label = normalized(field.label || field.columnId)
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[：:＊*]+$/g, '');
  return /^(?:备注|附注|说明|补充(?:说明|信息)?|其他(?:说明|信息)?)$/.test(label);
}

function rowCompletenessFields(row: AgentFieldRow): AgentTargetField[] {
  return row.fields.filter((field) => !field.protected && !isOptionalRepeatField(field));
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
    if (planned && isPageValueConsistent(observed, planned)) {
      return { status: 'verified', marker: 'verified', canOverwrite: true, observedValue: observed, plannedValue: planned };
    }
    if (previous && isPageValueConsistent(observed, previous)) {
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
  const usableFields = rowCompletenessFields(row);
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

function expectsYearMonth(field: AgentTargetField): boolean {
  return field.formatHints.some((hint) => /\d{4}-\d{1,2}|yyyy-mm/i.test(hint));
}

function normalizeDateForField(value: string, field: AgentTargetField): string | null {
  if (!expectsYearMonth(field)) return value;
  const match = value.match(/(\d{4})\D{0,3}(\d{1,2})(?:\D|$)/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

function normalizePlannedValue(value: AgentPlannedValue, field: AgentTargetField): string | null {
  let result = normalized(value.value);
  const semanticLabel = normalized(field.label || field.columnId).replace(/[（(].*$/, '');
  if (/^地点$/.test(semanticLabel)) {
    if (/^(?:市级|省级|校级|院级|国家级|国际级|全国级)$/.test(result)) return null;
    const directional = result.match(/^(华东|华北|华南|东北|西北|西南|中南)(?:区域赛|地区赛|赛区|区域)$/)?.[1];
    if (directional) result = `${directional}地区`;
    const province = result.match(/^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|台湾)赛区$/)?.[1];
    if (province) {
      result = ['北京', '天津', '上海', '重庆', '香港', '澳门'].includes(province)
        ? `${province}市`
        : `${province}省`;
    }
  }
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
    const preservedTargetIds = new Set<string>();

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
        const observed = normalized(context.observedValues[value.targetId]);
        if (action.type === 'fill_row' && observed && expectsYearMonth(location.field)) {
          preservedTargetIds.add(value.targetId);
          manualTargets.add(value.targetId);
          reviewItems.push(reviewItem(action.actionId, value.targetId, '网页已有日期缺少月份，保留现值并在最终审核中确认'));
          continue;
        }
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
      const expectedTargetIds = row ? rowCompletenessFields(row).map((field) => field.targetId) : [];
      const plannedTargetIds = new Set(values.map((value) => value.targetId));
      const missingColumns = expectedTargetIds.filter((targetId) => (
        !plannedTargetIds.has(targetId) && !normalized(context.observedValues[targetId])
      ));
      if (missingColumns.length > 0) {
        rejected = true;
        reviewItems.push(reviewItem(action.actionId, undefined, `整行计划缺少 ${missingColumns.length} 个列值`));
      }
    }

    if (rejected || normalizedValues.length + preservedTargetIds.size !== values.length) {
      rejectedActionIds.push(action.actionId);
      continue;
    }
    if (action.type === 'fill_row') {
      if (normalizedValues.length > 0) executableActions.push({ ...action, values: normalizedValues });
    } else {
      executableActions.push({ ...action, ...normalizedValues[0] });
    }
  }

  return {
    executableActions,
    reviewItems,
    manualTargets: [...manualTargets],
    rejectedActionIds,
  };
}

export function blockingAgentReviewItems(
  plan: AgentPagePlan,
  snapshot: AgentPageSnapshot,
  reviewItems: AgentReviewItem[],
  executableActionIds: ReadonlySet<string> = new Set(),
  executableTargetIds: ReadonlySet<string> = new Set(),
  hasRelevantSources = false,
): AgentReviewItem[] {
  if (reviewItems.length === 0) return [];
  const fields = snapshot.groups.flatMap((group) => group.fields);
  const populatedTargetIds = new Set(fields
    .filter((field) => normalized(field.currentValue))
    .map((field) => field.targetId));
  const blockingItems = reviewItems.filter((item) => (
    (!item.actionId || !executableActionIds.has(item.actionId))
    && (!item.targetId || !executableTargetIds.has(item.targetId))
    && (!item.targetId || !populatedTargetIds.has(item.targetId))
  ));
  if (blockingItems.length === 0) return [];
  const isResolvedNoActionPage = (
    plan.actions.length === 0 &&
    blockingItems.every((item) => !item.actionId && !item.targetId) &&
    fields.every((field) => !field.required || Boolean(normalized(field.currentValue))) &&
    (fields.some((field) => Boolean(normalized(field.currentValue))) || !hasRelevantSources)
  );
  return isResolvedNoActionPage ? [] : blockingItems;
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
