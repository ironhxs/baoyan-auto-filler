import { requestModelText } from '../matcher';
import type { ApiConfig } from '../storage';
import { AgentPlanValidationError, parseAgentPagePlan } from './planner-response';
import {
  createAgentPlanningChunks,
  mergeAgentChunkPlans,
  type AgentPlanningChunk,
  type AgentPlanningInput,
} from './planner-chunks';
import { buildAgentPlannerPrompt } from './planner-prompt';
import type { AgentSourceRecord } from './profile-retriever';
import { validateAgentPlan } from './policy';
import type { TargetFieldSchema } from '../profile-projections';
import type { RepeatDialogRecordTarget } from '../repeatable-records';
import type {
  AgentFieldGroup,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedValue,
  AgentTargetField,
} from './types';

export interface RequestAgentPagePlanInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

export interface RequestAgentPagePlanOptions {
  requestText?: typeof requestModelText;
  onChunkProgress?(completed: number, total: number): void | Promise<void>;
  loadChunkPlan?(chunk: AgentPlanningChunk, index: number, total: number): Promise<AgentPagePlan | null>;
  saveChunkPlan?(chunk: AgentPlanningChunk, plan: AgentPagePlan, index: number, total: number): Promise<void>;
  loadPlan?(input: RequestAgentPagePlanInput): Promise<AgentPagePlan | null>;
  savePlan?(input: RequestAgentPagePlanInput, plan: AgentPagePlan): Promise<void>;
}

export interface RepeatDialogAgentPlanningContext {
  pageKey: string;
  pageUrl: string;
  pageTitle: string;
  stepText: string;
  instructions: string[];
  visibleTexts: string[];
  groupLabel: string;
  schema: TargetFieldSchema;
  record: RepeatDialogRecordTarget;
}

export interface RepeatDialogAgentCompletionResult {
  record: RepeatDialogRecordTarget;
  attempted: boolean;
  complete: boolean;
  reviewed: number;
  error: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'capturedAt' && key !== 'updatedAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function agentFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `fp_${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

function uniqueText(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function repeatDialogTargetId(pageKey: string, groupLabel: string, key: string, index: number): string {
  return `repeat_${agentFingerprint({ pageKey, groupLabel, key, index }).slice(3)}`;
}

function stagedRepeatValue(
  record: RepeatDialogRecordTarget,
  field: TargetFieldSchema['fields'][number],
): string {
  const pageValue = field.currentValue?.trim() ?? '';
  if (pageValue) return pageValue;
  return record.fields.find((candidate) => candidate.key === field.key)?.value.trim() ?? '';
}

export function buildRepeatDialogAgentPlanningInput(
  input: RepeatDialogAgentPlanningContext,
): RequestAgentPagePlanInput {
  const groupId = `repeat_group_${agentFingerprint({
    pageKey: input.pageKey,
    groupLabel: input.groupLabel,
  }).slice(3)}`;
  const fields: AgentTargetField[] = input.schema.fields.map((field, index) => ({
    targetId: repeatDialogTargetId(input.pageKey, input.groupLabel, field.key, index),
    index,
    rowIndex: 0,
    columnId: `repeat_column_${index}`,
    label: field.label || field.key,
    currentValue: stagedRepeatValue(input.record, field),
    required: Boolean(field.required),
    protected: Boolean(field.protected),
    kind: 'text',
    options: [...(field.options ?? [])],
    placeholder: field.placeholder ?? '',
    formatHints: [...(field.formatHints ?? [])],
    forbiddenCharacters: [...(field.forbiddenCharacters ?? [])],
    maxLength: field.maxLength,
    questionText: field.questionText,
    annotations: [...(field.annotations ?? [])],
    contextHtml: '',
  }));
  const group: AgentFieldGroup = {
    groupId,
    label: input.groupLabel,
    kind: 'repeatable',
    columns: fields.map((field) => ({
      columnId: field.columnId!,
      label: field.label,
    })),
    fields,
    rows: [{ rowIndex: 0, fields }],
    observation: {
      presentation: 'dialog',
      tableHeaders: [],
      fieldLabels: fields.map((field) => field.label),
      currentRowCount: 0,
      hasAddControl: true,
      dialogVisible: true,
    },
  };
  const fieldInstructions = input.schema.fields.flatMap((field) => [
    field.questionText ?? '',
    ...(field.annotations ?? []),
    ...(field.formatHints ?? []),
    field.forbiddenCharacters?.length
      ? `${field.label || field.key}不得包含：${field.forbiddenCharacters.join('、')}`
      : '',
  ]);
  const visibleTextInstruction = uniqueText(input.visibleTexts).length > 0
    ? `当前页面可见语义：${uniqueText(input.visibleTexts).join('；')}`
    : '';
  const instructions = uniqueText([
    ...input.instructions,
    ...fieldInstructions,
    visibleTextInstruction,
    `当前只处理“${input.groupLabel}”弹窗中的第 ${input.record.itemIndex + 1} 条记录。`,
    `候选资料只允许使用 sourceRecordId=${input.record.sourceRecord.recordId}；不得引用其他条目或推测缺失事实。`,
    'currentValue 非空的字段表示本地映射或网页现值已经暂存，不要在计划中重复填写或覆盖；只补充仍为空且有资料证据的字段。',
    '当前弹窗是一条原子记录。优先使用一个 fill_row 动作；无法从资料证明的字段留空并加入 reviewItems，不得编造。',
  ]);
  const snapshot: AgentPageSnapshot = {
    pageKey: `${input.pageKey}::repeat::${input.groupLabel}::${input.record.sourceRecord.recordId}`,
    url: input.pageUrl,
    title: input.pageTitle || input.groupLabel,
    stepText: input.stepText || input.groupLabel,
    instructions,
    visiblePageText: uniqueText(input.visibleTexts),
    questionContext: {
      fullText: uniqueText(input.visibleTexts).join('\n'),
      annotations: uniqueText(fieldInstructions),
      dateExamples: uniqueText(input.schema.fields.flatMap((field) => field.formatHints ?? [])),
      forbiddenCharacters: uniqueText(input.schema.fields.flatMap((field) => field.forbiddenCharacters ?? [])),
      maxLength: input.schema.fields
        .map((field) => field.maxLength)
        .filter((value): value is number => Number.isFinite(value) && Number(value) > 0)
        .sort((left, right) => left - right)[0],
    },
    groups: [group],
    capturedAt: Date.now(),
  };
  return {
    snapshot,
    sourceRecords: [structuredClone(input.record.sourceRecord)],
  };
}

function plannedRepeatValues(
  actions: AgentPagePlan['actions'],
  sourceRecordId: string,
): AgentPlannedValue[] {
  return actions.flatMap((action) => {
    if ('sourceRecordId' in action && action.sourceRecordId !== sourceRecordId) return [];
    if (action.type === 'fill_row') return action.values;
    if (action.type === 'fill_field' || action.type === 'select') return [action];
    return [];
  });
}

export async function completeRepeatDialogRecordWithAgent(
  input: RepeatDialogAgentPlanningContext,
  apiConfig: ApiConfig,
  options: RequestAgentPagePlanOptions = {},
): Promise<RepeatDialogAgentCompletionResult> {
  const planningInput = buildRepeatDialogAgentPlanningInput(input);
  try {
    const cachedPlan = await options.loadPlan?.(planningInput);
    const plan = cachedPlan ?? await requestAgentPagePlan(planningInput, apiConfig, options);
    if (!cachedPlan) await options.savePlan?.(planningInput, plan);
    const observedValues = Object.fromEntries(planningInput.snapshot.groups[0].fields
      .map((field) => [field.targetId, field.currentValue]));
    const validated = validateAgentPlan(plan, {
      snapshot: planningInput.snapshot,
      sourceRecords: planningInput.sourceRecords,
      observedValues,
      lastAgentValues: {},
    });
    const fieldsByTargetId = new Map(planningInput.snapshot.groups[0].fields
      .map((field, index) => [field.targetId, input.schema.fields[index]] as const));
    const values = plannedRepeatValues(validated.executableActions, input.record.sourceRecord.recordId);
    const valueByKey = new Map(input.record.fields
      .map((field) => [field.key, field.value.trim()] as const)
      .filter(([, value]) => Boolean(value)));
    for (const value of values) {
      const schemaField = fieldsByTargetId.get(value.targetId);
      if (!schemaField || schemaField.protected || !value.value.trim()) continue;
      valueByKey.set(schemaField.key, value.value.trim());
    }
    const mergedFields = input.schema.fields.flatMap((field) => {
      const value = valueByKey.get(field.key) ?? '';
      return value ? [{ key: field.key, value }] : [];
    });
    const complete = input.schema.fields
      .filter((field) => field.required)
      .every((field) => Boolean(field.currentValue?.trim() || valueByKey.get(field.key)?.trim()));
    const reviewedTargets = new Set(values.filter((value) => value.needsReview).map((value) => value.targetId));
    return {
      record: { ...input.record, fields: mergedFields },
      attempted: true,
      complete,
      reviewed: reviewedTargets.size + plan.reviewItems.length,
      error: complete || validated.reviewItems.length === 0
        ? ''
        : validated.reviewItems.map((item) => item.message).join('；').slice(0, 500),
    };
  } catch (error) {
    return {
      record: input.record,
      attempted: true,
      complete: input.schema.fields
        .filter((field) => field.required)
        .every((field) => Boolean(field.currentValue?.trim()
          || input.record.fields.find((candidate) => candidate.key === field.key)?.value.trim())),
      reviewed: 0,
      error: (error instanceof Error ? error.message : 'Dynamic record Agent completion failed')
        .replace(/\s+/g, ' ')
        .slice(0, 500),
    };
  }
}

function validateFingerprints(
  plan: AgentPagePlan,
  snapshotFingerprint: string,
  profileFingerprint: string,
): AgentPagePlan {
  if (plan.snapshotFingerprint !== snapshotFingerprint) {
    throw new Error('Agent plan fingerprint does not match the current page snapshot');
  }
  if (plan.profileFingerprint !== profileFingerprint) {
    throw new Error('Agent plan fingerprint does not match the current profile records');
  }
  return plan;
}

async function requestSingleAgentPagePlan(
  input: AgentPlanningInput,
  apiConfig: ApiConfig,
  requestText: typeof requestModelText,
): Promise<AgentPagePlan> {
  const snapshotFingerprint = agentFingerprint(input.snapshot);
  const profileFingerprint = agentFingerprint(input.sourceRecords);
  const wireSnapshot: AgentPageSnapshot = {
    ...input.snapshot,
    pageKey: `page_${snapshotFingerprint}`,
  };
  const basePrompt = buildAgentPlannerPrompt({
    ...input,
    snapshot: wireSnapshot,
    snapshotFingerprint,
    profileFingerprint,
  }, { includeSchema: true });
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await requestText(apiConfig, prompt, { stream: true });
    try {
      const parsed = validateFingerprints(parseAgentPagePlan(text, {
        snapshot: wireSnapshot,
        sourceRecords: input.sourceRecords,
        fileRecordIds: input.fileRecordIds,
      }), snapshotFingerprint, profileFingerprint);
      return { ...parsed, pageKey: input.snapshot.pageKey };
    } catch (error) {
      if (!(error instanceof AgentPlanValidationError) || attempt > 0) throw error;
      prompt = [
        basePrompt,
        '上一版计划未通过本地语义校验。只修正 JSON 计划，不要解释，也不要放宽事实证据或安全边界。',
        `校验错误：${error.message.slice(0, 500)}`,
      ].join('\n\n');
    }
  }
  throw new Error('Agent plan repair attempt did not return a valid plan');
}

export async function requestAgentPagePlan(
  input: RequestAgentPagePlanInput,
  apiConfig: ApiConfig,
  options: RequestAgentPagePlanOptions = {},
): Promise<AgentPagePlan> {
  const snapshotFingerprint = agentFingerprint(input.snapshot);
  const profileFingerprint = agentFingerprint(input.sourceRecords);
  const chunks = createAgentPlanningChunks(input);
  if (chunks.length === 0) {
    return {
      version: 1,
      pageKey: input.snapshot.pageKey,
      snapshotFingerprint,
      profileFingerprint,
      actions: [],
      reviewItems: [],
    };
  }
  if (chunks.length === 1) {
    const plan = await requestSingleAgentPagePlan(chunks[0], apiConfig, options.requestText ?? requestModelText);
    await options.onChunkProgress?.(1, 1);
    return validateFingerprints({
      ...plan,
      snapshotFingerprint,
      profileFingerprint,
    }, snapshotFingerprint, profileFingerprint);
  }

  const plans: AgentPagePlan[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const cachedChunk = await options.loadChunkPlan?.(chunk, index, chunks.length) ?? null;
    const plan = cachedChunk
      ? validateFingerprints(
          cachedChunk,
          agentFingerprint(chunk.snapshot),
          agentFingerprint(chunk.sourceRecords),
        )
      : await requestSingleAgentPagePlan(chunk, apiConfig, options.requestText ?? requestModelText);
    plans.push(plan);
    if (!cachedChunk) await options.saveChunkPlan?.(chunk, plan, index, chunks.length);
    await options.onChunkProgress?.(plans.length, chunks.length);
  }
  return validateFingerprints(
    mergeAgentChunkPlans(chunks, plans, snapshotFingerprint, profileFingerprint),
    snapshotFingerprint,
    profileFingerprint,
  );
}
