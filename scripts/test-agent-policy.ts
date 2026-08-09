import assert from 'node:assert/strict';

import {
  canAgentAdvance,
  deriveAgentFieldStatus,
  deriveAgentRowStatus,
  validateAgentPlan,
} from '../utils/agent/policy';
import type {
  AgentFieldRow,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentTargetField,
} from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';

function field(targetId: string, label: string, extra: Partial<AgentTargetField> = {}): AgentTargetField {
  return {
    targetId,
    index: Number(targetId.replace(/\D/g, '')) || 0,
    label,
    currentValue: '',
    required: true,
    protected: false,
    kind: 'text',
    options: [],
    placeholder: '',
    formatHints: [],
    forbiddenCharacters: [],
    ...extra,
  };
}

const row: AgentFieldRow = {
  rowIndex: 0,
  fields: [
    field('f1', '时间', { rowIndex: 0, columnId: 'time', formatHints: ['2018-11'] }),
    field('f2', '地点', { rowIndex: 0, columnId: 'place' }),
    field('f3', '内容', { rowIndex: 0, columnId: 'content', forbiddenCharacters: ['|', '#'] }),
  ],
};

const partial = deriveAgentRowStatus(row, { f1: '2026-01' }, {});
assert.equal(partial.status, 'partial');
assert.equal(partial.marker, 'review');
assert.equal(partial.blocksAdvance, true);

const complete = deriveAgentRowStatus(
  row,
  { f1: '2026-01', f2: '华东区域赛', f3: 'OopsOS，操作系统设计赛，三等奖' },
  {},
);
assert.equal(complete.status, 'complete');
assert.equal(complete.marker, 'verified');
assert.equal(complete.blocksAdvance, false);

const manual = deriveAgentFieldStatus(
  field('manual', '学习信息'),
  'Agent计划值',
  '用户刚刚修改的值',
  'Agent上次填写的值',
);
assert.equal(manual.status, 'manual');
assert.equal(manual.canOverwrite, false);

const snapshot: AgentPageSnapshot = {
  pageKey: 'fudan-awards',
  url: 'https://example.test/awards',
  title: '奖励情况',
  stepText: '',
  instructions: ['内容中不得含有 |、#'],
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
    fields: row.fields,
    rows: [row],
  }],
};

const sources: AgentSourceRecord[] = [{
  recordId: 'subject_competitions:0',
  categoryId: 'subject_competitions',
  categoryLabel: '学科竞赛',
  itemIndex: 0,
  fields: { 获奖时间: '2026-01', 获奖等级: '华东区域赛三等奖', 项目: 'Oops|OS#' },
  searchText: '',
}];

const plan: AgentPagePlan = {
  version: 1,
  pageKey: snapshot.pageKey,
  snapshotFingerprint: 's1',
  profileFingerprint: 'p1',
  actions: [{
    actionId: 'row-0',
    type: 'fill_row',
    groupId: 'awards',
    rowIndex: 0,
    sourceRecordId: sources[0].recordId,
    values: [
      { targetId: 'f1', value: '2026年1月', evidenceFields: ['获奖时间'], confidence: 0.99, needsReview: false, reason: '日期转换' },
      { targetId: 'f2', value: '华东区域赛', evidenceFields: ['获奖等级'], confidence: 0.85, needsReview: true, reason: '赛事范围' },
      { targetId: 'f3', value: 'Oops|OS#', evidenceFields: ['项目'], confidence: 0.95, needsReview: false, reason: '项目名称' },
    ],
  }],
  reviewItems: [],
};

const validated = validateAgentPlan(plan, {
  snapshot,
  sourceRecords: sources,
  observedValues: {},
  lastAgentValues: {},
});
assert.equal(validated.executableActions.length, 1);
const executable = validated.executableActions[0];
assert.equal(executable.type, 'fill_row');
if (executable.type !== 'fill_row') throw new Error('expected fill_row');
assert.equal(executable.values[0].value, '2026-01');
assert.equal(executable.values[2].value, 'OopsOS');

const protectedResult = validateAgentPlan(plan, {
  snapshot,
  sourceRecords: sources,
  observedValues: { f2: '用户人工修正地点' },
  lastAgentValues: { f2: 'Agent旧地点' },
});
assert.equal(protectedResult.executableActions.length, 0, 'a row with a manual value must remain atomic');
assert.deepEqual(protectedResult.manualTargets, ['f2']);

const missingEvidencePlan = structuredClone(plan);
if (missingEvidencePlan.actions[0].type === 'fill_row') {
  missingEvidencePlan.actions[0].values[2].evidenceFields = [];
}
assert.equal(validateAgentPlan(missingEvidencePlan, {
  snapshot,
  sourceRecords: sources,
  observedValues: {},
  lastAgentValues: {},
}).executableActions.length, 0);

const verifiedStatuses = { f1: 'verified', f2: 'manual', f3: 'verified' } as const;
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '最终提交',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '确认报名',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '选择导师并下一步',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '下一步',
  fieldStatuses: { ...verifiedStatuses, f2: 'empty' },
  rowStatuses: [partial],
}), false);
assert.equal(canAgentAdvance({
  snapshot,
  nextActionLabel: '下一步',
  fieldStatuses: verifiedStatuses,
  rowStatuses: [complete],
}), true);

console.log('agent policy tests passed');
