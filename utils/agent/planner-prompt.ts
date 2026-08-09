import type { ModelJsonSchema } from '../matcher';
import type { AgentSourceRecord } from './profile-retriever';
import type { AgentPageSnapshot } from './types';

const plannedValueProperties = {
  targetId: { type: 'string', minLength: 1 },
  value: { type: 'string', minLength: 1 },
  evidenceFields: { type: 'array', items: { type: 'string', minLength: 1 } },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  needsReview: { type: 'boolean' },
  reason: { type: 'string', minLength: 1 },
} as const;

const plannedValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(plannedValueProperties),
  properties: plannedValueProperties,
};

const unifiedActionProperties = {
  actionId: { type: 'string', minLength: 1 },
  type: { enum: ['add_rows', 'fill_field', 'fill_row', 'select', 'upload'] },
  groupId: { type: 'string' },
  count: { type: 'integer', minimum: 0, maximum: 24 },
  sourceRecordId: { type: 'string' },
  targetId: { type: 'string' },
  fileRecordId: { type: 'string' },
  rowIndex: { type: 'integer', minimum: -1 },
  value: { type: 'string' },
  evidenceFields: { type: 'array', items: { type: 'string', minLength: 1 } },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  needsReview: { type: 'boolean' },
  reason: { type: 'string', minLength: 1 },
  values: { type: 'array', items: plannedValueSchema },
} as const;

const unifiedActionSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(unifiedActionProperties),
  properties: unifiedActionProperties,
};

export const BAOTIAN_PAGE_PLAN_SCHEMA: ModelJsonSchema = {
  name: 'baotian_page_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'version', 'pageKey', 'snapshotFingerprint', 'profileFingerprint', 'actions', 'reviewItems',
    ],
    properties: {
      version: { const: 1 },
      pageKey: { type: 'string', minLength: 1 },
      snapshotFingerprint: { type: 'string', minLength: 1 },
      profileFingerprint: { type: 'string', minLength: 1 },
      actions: { type: 'array', items: unifiedActionSchema },
      reviewItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['reviewId', 'targetId', 'actionId', 'message'],
          properties: {
            reviewId: { type: 'string', minLength: 1 },
            targetId: { type: ['string', 'null'] },
            actionId: { type: ['string', 'null'] },
            message: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

export interface AgentPlannerPromptInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  snapshotFingerprint: string;
  profileFingerprint: string;
  fileRecordIds?: string[];
}

export interface AgentPlannerPromptOptions {
  includeSchema?: boolean;
}

function safeField(field: AgentPageSnapshot['groups'][number]['fields'][number]): Record<string, unknown> {
  const sensitive = /密码|口令|验证码|支付密码|短信码/i.test(field.label);
  return {
    targetId: field.targetId,
    rowIndex: field.rowIndex ?? null,
    columnId: field.columnId ?? null,
    label: field.label,
    currentValue: sensitive || field.protected ? '[受保护]' : field.currentValue,
    required: field.required,
    protected: field.protected || sensitive,
    kind: field.kind,
    options: field.options,
    placeholder: sensitive ? '' : field.placeholder,
    formatHints: field.formatHints,
    forbiddenCharacters: field.forbiddenCharacters,
    maxLength: field.maxLength ?? null,
  };
}

export function buildAgentPlannerPrompt(
  input: AgentPlannerPromptInput,
  options: AgentPlannerPromptOptions = {},
): string {
  const page = {
    pageKey: input.snapshot.pageKey,
    url: input.snapshot.url,
    title: input.snapshot.title,
    stepText: input.snapshot.stepText,
    instructions: input.snapshot.instructions,
    groups: input.snapshot.groups.map((group) => {
      const rowTargetIds = new Set(group.rows.flatMap((row) => row.fields.map((field) => field.targetId)));
      return {
        groupId: group.groupId,
        label: group.label,
        kind: group.kind,
        columns: group.columns,
        fields: group.fields.filter((field) => !rowTargetIds.has(field.targetId)).map(safeField),
        rows: group.rows.map((row) => ({ rowIndex: row.rowIndex, fields: row.fields.map(safeField) })),
      };
    }),
  };
  const records = input.sourceRecords.map((record) => ({
    recordId: record.recordId,
    categoryId: record.categoryId,
    categoryLabel: record.categoryLabel,
    fields: record.fields,
  }));

  const sections = [
    '你是“保填 Agent”的页面规划器。请根据网页实际字段、填写规则与候选资料生成严格 JSON 计划。',
    '只规划，不执行网页操作。只允许 add_rows、fill_field、fill_row、select、upload；绝不提交、确认报名、勾选承诺书、选择导师/志愿、处理验证码、支付或删除。',
    'actions 使用统一字段结构，所有字段都必须返回。未被当前动作使用的字符串填空字符串，count 填 0，rowIndex 填 -1，evidenceFields/values 填空数组；fill_row 的 values 必须包含该行要写入的全部子字段。',
    '每个值必须绑定一个真实 sourceRecordId，并在 evidenceFields 中列出该记录中真实存在且支撑该值的字段。不得凭空补造事实。',
    '重复表格必须按“同一网页行对应同一资料记录”规划。若一行包含时间、地点、内容，必须完整理解整行并使用 fill_row；不可只填时间留下半行。',
    '可以按网页要求组合、拆分、改写格式和去除禁用字符，但不得改变事实；不确定时 needsReview=true。',
    '非空且受保护的网页值不得覆盖。reviewItems 的 targetId/actionId 无对应项时使用 null。',
    `必须原样返回 version=1、pageKey=${input.snapshot.pageKey}、snapshotFingerprint=${input.snapshotFingerprint}、profileFingerprint=${input.profileFingerprint}。`,
    `页面语义快照：\n${JSON.stringify(page)}`,
    `候选资料记录：\n${JSON.stringify(records)}`,
    `可用材料记录 ID：\n${JSON.stringify(input.fileRecordIds ?? [])}`,
  ];
  if (options.includeSchema) {
    sections.push(`输出 JSON Schema：\n${JSON.stringify(BAOTIAN_PAGE_PLAN_SCHEMA.schema)}`);
  }
  return sections.join('\n\n');
}
