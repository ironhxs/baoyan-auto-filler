import assert from 'node:assert/strict';

import { buildAgentExecutionBatch } from '../utils/agent/executor';
import { verifyAgentExecution } from '../utils/agent/verifier';
import type { AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';

const snapshot: AgentPageSnapshot = {
  pageKey: 'page-signature-1',
  url: 'https://example.test/awards',
  title: '奖励情况',
  stepText: '',
  instructions: [],
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
    rows: [{
      rowIndex: 0,
      fields: [
        { targetId: 'time-target', index: 7, rowIndex: 0, columnId: 'time', label: '时间', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: ['2018-11'], forbiddenCharacters: [] },
        { targetId: 'place-target', index: 8, rowIndex: 0, columnId: 'place', label: '地点', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
        { targetId: 'content-target', index: 9, rowIndex: 0, columnId: 'content', label: '内容', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
      ],
    }],
  }],
};
snapshot.groups[0].fields = snapshot.groups[0].rows[0].fields;

const plan: AgentPagePlan = {
  version: 1,
  pageKey: snapshot.pageKey,
  snapshotFingerprint: 's1',
  profileFingerprint: 'p1',
  actions: [{
    actionId: 'fill-row',
    type: 'fill_row',
    groupId: 'awards',
    rowIndex: 0,
    sourceRecordId: 'awards:0',
    // Deliberately shuffled: the executor must follow the observed page column order.
    values: [
      { targetId: 'content-target', value: 'OopsOS，操作系统设计赛，三等奖', evidenceFields: ['项目'], confidence: 0.96, needsReview: false, reason: '内容' },
      { targetId: 'time-target', value: '2026-01', evidenceFields: ['时间'], confidence: 0.99, needsReview: false, reason: '时间' },
      { targetId: 'place-target', value: '华东区域赛', evidenceFields: ['等级'], confidence: 0.85, needsReview: true, reason: '地点' },
    ],
  }],
  reviewItems: [],
};

const batch = buildAgentExecutionBatch(plan, snapshot);
assert.equal(batch.pageKey, snapshot.pageKey);
assert.deepEqual(batch.items.map((item) => item.targetId), [
  'time-target', 'place-target', 'content-target',
]);
assert.deepEqual(batch.items.map((item) => item.index), [7, 8, 9]);
assert.equal(batch.items.every((item) => item.actionId === 'fill-row'), true);
assert.equal(batch.items.every((item) => item.sourceRecordId === 'awards:0'), true);
assert.equal(batch.items.every((item) => item.rowIndex === 0), true);
assert.deepEqual(batch.items.map((item) => item.confidence), ['high', 'medium', 'high']);

const updatedSnapshot = structuredClone(snapshot);
updatedSnapshot.groups[0].rows[0].fields[0].index = 70;
updatedSnapshot.groups[0].fields = updatedSnapshot.groups[0].rows[0].fields;
assert.equal(buildAgentExecutionBatch(plan, updatedSnapshot).items[0].index, 70);

const missingTargetSnapshot = structuredClone(snapshot);
missingTargetSnapshot.groups[0].rows[0].fields = missingTargetSnapshot.groups[0].rows[0].fields.slice(0, 2);
missingTargetSnapshot.groups[0].fields = missingTargetSnapshot.groups[0].rows[0].fields;
const missingBatch = buildAgentExecutionBatch(plan, missingTargetSnapshot);
assert.deepEqual(missingBatch.missingTargetIds, ['content-target']);
assert.equal(missingBatch.safeToExecute, false);

const expected = Object.fromEntries(batch.items.map((item) => [item.targetId, item.value]));
const verified = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: {},
  afterValues: expected,
  lastAgentValues: {},
});
assert.deepEqual(Object.values(verified.fieldStatuses), ['verified', 'verified', 'verified']);
assert.equal(verified.rowStatuses[0].status, 'complete');

const formattedDateVerified = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: { ...expected, 'time-target': '2026年1月' },
  afterValues: { ...expected, 'time-target': '2026年1月' },
  lastAgentValues: {},
});
assert.equal(
  formattedDateVerified.fieldStatuses['time-target'],
  'verified',
  'readback using the website date display format must verify against the normalized plan value',
);

const partial = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: {},
  afterValues: { 'time-target': '2026-01' },
  lastAgentValues: {},
});
assert.equal(partial.rowStatuses[0].status, 'partial');
assert.equal(partial.rowStatuses[0].blocksAdvance, true);

const manual = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: { 'place-target': '用户人工地点' },
  afterValues: { ...expected, 'place-target': '用户人工地点' },
  lastAgentValues: { 'place-target': 'Agent旧地点' },
});
assert.equal(manual.fieldStatuses['place-target'], 'manual');

const failed = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: {},
  afterValues: { ...expected, 'content-target': '' },
  lastAgentValues: {},
  executionResults: [{
    actionId: 'fill-row', targetId: 'content-target', attempted: true,
    observed: '', matched: false, reason: 'write-readback-mismatch',
  }],
});
assert.equal(failed.fieldStatuses['content-target'], 'failed');

const missing = verifyAgentExecution({
  plan,
  snapshot,
  beforeValues: {},
  afterValues: {},
  lastAgentValues: {},
  executionResults: [{
    actionId: 'fill-row', targetId: 'content-target', attempted: false,
    observed: '', matched: false, reason: 'target-not-found',
  }],
});
assert.equal(missing.fieldStatuses['content-target'], 'failed');
assert.deepEqual(missing.retryableTargetIds, ['content-target']);

assert.throws(
  () => buildAgentExecutionBatch(plan, { ...snapshot, pageKey: 'different-page' }),
  /pageKey/,
);

console.log('agent execution tests passed');
