import assert from 'node:assert/strict';

import * as agentPlanner from '../utils/agent/planner';
import type { TargetFieldSchema } from '../utils/profile-projections';
import type { RepeatDialogRecordTarget } from '../utils/repeatable-records';
import type { ApiConfig } from '../utils/storage';

const buildPlanningInput = (agentPlanner as Record<string, unknown>)
  .buildRepeatDialogAgentPlanningInput as undefined | ((input: {
    pageKey: string;
    pageUrl: string;
    pageTitle: string;
    stepText: string;
    instructions: string[];
    visibleTexts: string[];
    groupLabel: string;
    schema: TargetFieldSchema;
    record: RepeatDialogRecordTarget;
  }) => {
    snapshot: import('../utils/agent/types').AgentPageSnapshot;
    sourceRecords: import('../utils/agent/profile-retriever').AgentSourceRecord[];
  });
const completeRecord = (agentPlanner as Record<string, unknown>)
  .completeRepeatDialogRecordWithAgent as undefined | ((input: {
    pageKey: string;
    pageUrl: string;
    pageTitle: string;
    stepText: string;
    instructions: string[];
    visibleTexts: string[];
    groupLabel: string;
    schema: TargetFieldSchema;
    record: RepeatDialogRecordTarget;
  }, apiConfig: ApiConfig, options: {
    requestText: (config: ApiConfig, prompt: string) => Promise<string>;
  }) => Promise<{
    record: RepeatDialogRecordTarget;
    attempted: boolean;
    complete: boolean;
    reviewed: number;
    error: string;
  }>);

assert.equal(
  typeof buildPlanningInput,
  'function',
  'dynamic record completion must expose a single-record Agent planning input builder',
);
assert.equal(
  typeof completeRecord,
  'function',
  'dynamic record completion must expose a constrained Agent completion function',
);
if (!buildPlanningInput || !completeRecord) throw new Error('dynamic record Agent functions are unavailable');

const schema: TargetFieldSchema = {
  groupLabel: '项目经历',
  fields: [
    { key: '项目名称', label: '项目名称', required: true },
    {
      key: '项目描述',
      label: '项目描述',
      required: true,
      multiline: true,
      maxLength: 300,
      questionText: '项目经历 项目描述',
      annotations: ['请概述项目级别、研究内容和本人贡献'],
    },
    { key: '项目时间段', label: '项目时间段', required: true, formatHints: ['2025-07 至 2026-07'] },
    {
      key: '本人角色',
      label: '本人角色',
      required: true,
      questionText: '项目经历 本人角色',
      annotations: ['本人角色需与资料中的排名或明确职务一致'],
    },
  ],
};

const record: RepeatDialogRecordTarget = {
  itemIndex: 0,
  fields: [
    { key: '项目名称', value: 'PRISM-Net' },
    { key: '项目时间段', value: '2025.07-2026.07' },
  ],
  sourceRecord: {
    recordId: 'research_training:0',
    categoryId: 'research_training',
    categoryLabel: '科研训练',
    itemIndex: 0,
    fields: {
      起止时间: '2025.07-2026.07',
      项目名称: 'PRISM-Net',
      项目级别: '科研论文项目',
      排名: '第一',
    },
    searchText: '起止时间: 2025.07-2026.07；项目名称: PRISM-Net；项目级别: 科研论文项目；排名: 第一',
  },
};

const input = {
  pageKey: 'sysu-projects',
  pageUrl: 'https://example.test/application#/projects',
  pageTitle: '中山大学 计算机学院',
  stepText: '项目经历',
  instructions: ['所有带星号字段均为必填项'],
  visibleTexts: ['项目经历', '新增', '项目描述', '本人角色'],
  groupLabel: '项目经历',
  schema,
  record,
};

const planningInput = buildPlanningInput(input);
assert.equal(planningInput.sourceRecords.length, 1, 'one open record editor must receive exactly one source record');
assert.equal(planningInput.sourceRecords[0].recordId, record.sourceRecord.recordId);
assert.deepEqual(
  planningInput.snapshot.groups[0].rows[0].fields.map((field) => ({
    label: field.label,
    currentValue: field.currentValue,
    required: field.required,
    maxLength: field.maxLength,
  })),
  [
    { label: '项目名称', currentValue: 'PRISM-Net', required: true, maxLength: undefined },
    { label: '项目描述', currentValue: '', required: true, maxLength: 300 },
    { label: '项目时间段', currentValue: '2025.07-2026.07', required: true, maxLength: undefined },
    { label: '本人角色', currentValue: '', required: true, maxLength: undefined },
  ],
  'the Agent row must follow the live dialog order and treat local projections as staged current values',
);
assert.equal(
  planningInput.snapshot.instructions.some((instruction) => instruction.includes('本人角色需与资料中的排名')),
  true,
  'field annotations from the live dialog must be included in the Agent context',
);

const apiConfig: ApiConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'gpt-5.6',
  providerId: 'custom',
  apiMode: 'responses',
  fastMode: true,
  aiEnhanced: true,
};
const snapshotFingerprint = agentPlanner.agentFingerprint(planningInput.snapshot);
const profileFingerprint = agentPlanner.agentFingerprint(planningInput.sourceRecords);
const group = planningInput.snapshot.groups[0];
const targetByLabel = new Map(group.rows[0].fields.map((field) => [field.label, field.targetId]));
let capturedPrompt = '';
const completed = await completeRecord(input, apiConfig, {
  requestText: async (config, prompt) => {
    assert.equal(config.fastMode, true, 'dynamic record completion must preserve the configured fast-mode flag');
    capturedPrompt = prompt;
    return JSON.stringify({
      version: 1,
      pageKey: `page_${snapshotFingerprint}`,
      snapshotFingerprint,
      profileFingerprint,
      actions: [{
        actionId: 'complete-project-record',
        type: 'fill_row',
        groupId: group.groupId,
        rowIndex: 0,
        sourceRecordId: record.sourceRecord.recordId,
        values: [{
          targetId: targetByLabel.get('项目描述'),
          value: '科研论文项目，排名第一',
          evidenceFields: ['项目级别', '排名'],
          confidence: 0.93,
          needsReview: true,
          reason: '按当前弹窗描述字段组合已有项目事实',
        }, {
          targetId: targetByLabel.get('本人角色'),
          value: '排名第一',
          evidenceFields: ['排名'],
          confidence: 0.9,
          needsReview: true,
          reason: '资料仅明确本人排名，不扩写为负责人',
        }],
      }],
      reviewItems: [],
    });
  },
});

assert.equal(completed.attempted, true);
assert.equal(completed.complete, true, 'Agent may complete required dialog fields only from the bound source record');
assert.equal(completed.reviewed, 2, 'semantic rewrites marked needsReview must remain visible to the review accounting');
assert.equal(completed.error, '');
assert.deepEqual(completed.record.fields, [
  { key: '项目名称', value: 'PRISM-Net' },
  { key: '项目描述', value: '科研论文项目，排名第一' },
  { key: '项目时间段', value: '2025.07-2026.07' },
  { key: '本人角色', value: '排名第一' },
]);
assert.match(capturedPrompt, /本人角色需与资料中的排名或明确职务一致/u);
assert.match(capturedPrompt, /当前只处理“项目经历”弹窗中的第 1 条记录/u);

let invalidAttempts = 0;
const rejected = await completeRecord(input, apiConfig, {
  requestText: async () => {
    invalidAttempts += 1;
    return JSON.stringify({
      version: 1,
      pageKey: `page_${snapshotFingerprint}`,
      snapshotFingerprint,
      profileFingerprint,
      actions: [{
        actionId: 'invented-project-role',
        type: 'fill_row',
        groupId: group.groupId,
        rowIndex: 0,
        sourceRecordId: record.sourceRecord.recordId,
        values: [{
          targetId: targetByLabel.get('项目描述'),
          value: '国家级项目',
          evidenceFields: ['不存在的字段'],
          confidence: 0.99,
          needsReview: false,
          reason: '无来源',
        }],
      }],
      reviewItems: [],
    });
  },
});
assert.equal(invalidAttempts, 2, 'invalid Agent output must use the existing bounded JSON repair attempt');
assert.equal(rejected.complete, false, 'unknown evidence must never complete a dynamic record');
assert.deepEqual(rejected.record.fields, record.fields, 'a rejected Agent plan must preserve the deterministic local projection');
assert.match(rejected.error, /unknown evidence field/u);

console.log('agent repeat dialog completion tests passed');
