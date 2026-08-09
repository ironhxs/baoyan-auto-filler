import assert from 'node:assert/strict';

import {
  AgentPlanValidationError,
  parseAgentPagePlan,
} from '../utils/agent/planner-response';
import { BAOTIAN_PAGE_PLAN_SCHEMA } from '../utils/agent/planner-prompt';
import type { AgentPageSnapshot } from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';

const snapshot: AgentPageSnapshot = {
  pageKey: 'fudan-awards',
  url: 'https://gsas.fudan.edu.cn/tm/example',
  title: '奖励情况（本科期间）',
  stepText: '',
  instructions: ['日期格式：2018-11', '内容中不得含有 |、#'],
  capturedAt: 1,
  groups: [{
    groupId: 'awards',
    label: '奖励情况',
    kind: 'repeatable',
    columns: [
      { columnId: 'time', label: '时间' },
      { columnId: 'place', label: '地点' },
      { columnId: 'content', label: '内容' },
    ],
    fields: [],
    rows: [
      {
        rowIndex: 0,
        fields: [
          { targetId: 'r0-time', index: 0, rowIndex: 0, columnId: 'time', label: '时间', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: ['2018-11'], forbiddenCharacters: [] },
          { targetId: 'r0-place', index: 1, rowIndex: 0, columnId: 'place', label: '地点', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
          { targetId: 'r0-content', index: 2, rowIndex: 0, columnId: 'content', label: '内容', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: ['|', '#'] },
        ],
      },
      {
        rowIndex: 1,
        fields: [
          { targetId: 'r1-time', index: 3, rowIndex: 1, columnId: 'time', label: '时间', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: ['2018-11'], forbiddenCharacters: [] },
          { targetId: 'r1-place', index: 4, rowIndex: 1, columnId: 'place', label: '地点', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
          { targetId: 'r1-content', index: 5, rowIndex: 1, columnId: 'content', label: '内容', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: ['|', '#'] },
        ],
      },
    ],
  }],
};
snapshot.groups[0].fields = snapshot.groups[0].rows.flatMap((row) => row.fields);

const records: AgentSourceRecord[] = [{
  recordId: 'subject_competitions:0',
  categoryId: 'subject_competitions',
  categoryLabel: '学科竞赛',
  itemIndex: 0,
  fields: {
    获奖项目名称: 'OopsOS',
    竞赛名称: '全国大学生计算机系统能力大赛操作系统设计赛',
    获奖等级: '华东区域赛三等奖',
    获奖时间: '2026-01',
  },
  searchText: 'OopsOS 操作系统设计赛 华东区域赛三等奖 2026-01',
}];

const basePlan = {
  version: 1,
  pageKey: 'fudan-awards',
  snapshotFingerprint: 'snapshot-1',
  profileFingerprint: 'profile-1',
  actions: [{
    actionId: 'fill-award-0',
    type: 'fill_row',
    groupId: 'awards',
    rowIndex: 0,
    sourceRecordId: 'subject_competitions:0',
    values: [
      { targetId: 'r0-time', value: '2026-01', evidenceFields: ['获奖时间'], confidence: 0.99, needsReview: false, reason: '直接日期转换' },
      { targetId: 'r0-place', value: '华东区域赛', evidenceFields: ['获奖等级'], confidence: 0.86, needsReview: true, reason: '按页面的地点字段提取赛事范围' },
      { targetId: 'r0-content', value: 'OopsOS，全国大学生计算机系统能力大赛操作系统设计赛，三等奖', evidenceFields: ['获奖项目名称', '竞赛名称', '获奖等级'], confidence: 0.94, needsReview: false, reason: '按页面风格合成' },
    ],
  }],
  reviewItems: [],
};

const context = { snapshot, sourceRecords: records };
const plan = parseAgentPagePlan(JSON.stringify(basePlan), context);
assert.equal(plan.actions[0].type, 'fill_row');
if (plan.actions[0].type !== 'fill_row') throw new Error('expected fill_row');
assert.equal(plan.actions[0].sourceRecordId, 'subject_competitions:0');
assert.equal(plan.actions[0].values.length, 3);

const fencedPlan = parseAgentPagePlan(`\n\`\`\`json\n${JSON.stringify(basePlan)}\n\`\`\`\n`, context);
assert.equal(fencedPlan.actions.length, 1);

const actionItems = (BAOTIAN_PAGE_PLAN_SCHEMA.schema as any).properties.actions.items;
assert.equal('anyOf' in actionItems, false, 'relay wire schema must avoid expensive anyOf action branches');

const unifiedWirePlan = structuredClone(basePlan) as any;
unifiedWirePlan.actions[0] = {
  ...unifiedWirePlan.actions[0],
  targetId: '',
  fileRecordId: '',
  count: 0,
  value: '',
  evidenceFields: [],
  confidence: 0.95,
  needsReview: false,
  reason: '整行字段由同一条奖励记录生成',
};
const unifiedParsed = parseAgentPagePlan(JSON.stringify(unifiedWirePlan), context);
assert.equal(unifiedParsed.actions[0].type, 'fill_row');
assert.deepEqual(Object.keys(unifiedParsed.actions[0]).sort(), [
  'actionId', 'groupId', 'rowIndex', 'sourceRecordId', 'type', 'values',
].sort(), 'unused wire placeholders must be removed before policy validation and execution');

function expectInvalid(mutator: (value: Record<string, unknown>) => void, message: string): void {
  const value = structuredClone(basePlan) as unknown as Record<string, unknown>;
  mutator(value);
  assert.throws(
    () => parseAgentPagePlan(JSON.stringify(value), context),
    AgentPlanValidationError,
    message,
  );
}

expectInvalid((value) => {
  const actions = value.actions as Array<Record<string, unknown>>;
  actions[0].sourceRecordId = 'invented:99';
}, 'invented sourceRecordId must be rejected');

expectInvalid((value) => {
  const actions = value.actions as Array<Record<string, unknown>>;
  const values = actions[0].values as Array<Record<string, unknown>>;
  values[0].targetId = 'invented-target';
}, 'invented targetId must be rejected');

expectInvalid((value) => {
  const actions = value.actions as Array<Record<string, unknown>>;
  const values = actions[0].values as Array<Record<string, unknown>>;
  values[0].evidenceFields = ['不存在字段'];
}, 'invented evidence field must be rejected');

expectInvalid((value) => {
  const actions = value.actions as Array<Record<string, unknown>>;
  const values = actions[0].values as Array<Record<string, unknown>>;
  values[2].targetId = 'r1-content';
}, 'a fill_row action cannot cross rowIndex boundaries');

expectInvalid((value) => {
  const actions = value.actions as Array<Record<string, unknown>>;
  const duplicate = structuredClone(actions[0]);
  duplicate.actionId = 'duplicate-target-action';
  actions.push(duplicate);
}, 'the same target cannot be planned twice');

expectInvalid((value) => {
  value.actions = [{ actionId: 'unsafe', type: 'submit' }];
}, 'submit action must be rejected');

expectInvalid((value) => {
  value.actions = [{ actionId: 'unsafe', type: 'click', targetId: 'r0-time' }];
}, 'generic click action must be rejected');

expectInvalid((value) => {
  value.unexpected = true;
}, 'unknown top-level properties must be rejected');

console.log('agent planner response tests passed');
