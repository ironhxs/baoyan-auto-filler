import assert from 'node:assert/strict';
import {
  createAgentPlanningChunks,
  mergeAgentChunkPlans,
} from '../utils/agent/planner-chunks';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';

function repeatableSnapshot(rowCount: number): AgentPageSnapshot {
  const labels: Record<string, string> = { time: '时间', place: '地点', content: '内容' };
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
    rowIndex,
    fields: ['time', 'place', 'content'].map((columnId, columnIndex) => ({
      targetId: `award:${rowIndex}:${columnId}`,
      index: rowIndex * 3 + columnIndex,
      rowIndex,
      columnId,
      label: labels[columnId],
      currentValue: '',
      required: false,
      protected: false,
      kind: 'text' as const,
      options: [],
      placeholder: '',
      formatHints: columnId === 'time' ? ['YYYY-MM'] : [],
      forbiddenCharacters: columnId === 'content' ? ['|', '#'] : [],
    })),
  }));
  return {
    pageKey: 'award-page',
    url: 'https://example.test/award',
    title: '奖励情况（本科期间）',
    stepText: '奖励情况',
    instructions: ['日期格式：2025-09', '内容不得含有 |、#'],
    groups: [{
      groupId: 'award-table',
      label: '奖励情况',
      kind: 'repeatable',
      columns: [
        { columnId: 'time', label: '时间' },
        { columnId: 'place', label: '地点' },
        { columnId: 'content', label: '内容' },
      ],
      fields: rows.flatMap((row) => row.fields),
      rows,
    }],
    capturedAt: 1,
  };
}

function awardRecords(count: number): AgentSourceRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    recordId: `honors_awards:${index}`,
    categoryId: 'honors_awards',
    categoryLabel: '荣誉奖励',
    itemIndex: index,
    fields: { 获奖名称: `奖励 ${index + 1}`, 获奖时间: `2025-${String(index + 1).padStart(2, '0')}` },
    searchText: `获奖名称: 奖励 ${index + 1}`,
  }));
}

const large = createAgentPlanningChunks({
  snapshot: repeatableSnapshot(20),
  sourceRecords: awardRecords(18),
});

assert.equal(large.length, 9, 'relay-safe planning must keep every request to two complete rows');
assert.deepEqual(large.map((chunk) => chunk.snapshot.groups[0].rows.length), Array(9).fill(2));
assert.deepEqual(large.map((chunk) => chunk.snapshot.groups[0].fields.length), Array(9).fill(6));
assert.deepEqual(large.map((chunk) => chunk.sourceRecords.length), Array(9).fill(2));
assert.deepEqual(
  large.flatMap((chunk) => chunk.snapshot.groups[0].rows.map((row) => row.rowIndex)),
  Array.from({ length: 18 }, (_, index) => index),
  'rows must stay ordered and may not be split or repeated across requests',
);
assert.deepEqual(
  large.flatMap((chunk) => chunk.sourceRecords.map((record) => record.recordId)),
  awardRecords(18).map((record) => record.recordId),
  'candidate records must stay aligned with their global row range',
);

const small = createAgentPlanningChunks({
  snapshot: repeatableSnapshot(2),
  sourceRecords: awardRecords(2),
}, { maxFields: 18, maxRows: 6 });
assert.equal(small.length, 1);
assert.equal(small[0].snapshot.groups[0].rows.length, 2);

function chunkPlan(chunkIndex: number): AgentPagePlan {
  const row = large[chunkIndex].snapshot.groups[0].rows[0];
  const record = large[chunkIndex].sourceRecords[0];
  return {
    version: 1,
    pageKey: 'award-page',
    snapshotFingerprint: `chunk-snapshot-${chunkIndex}`,
    profileFingerprint: `chunk-profile-${chunkIndex}`,
    actions: [{
      actionId: 'fill-row',
      type: 'fill_row',
      groupId: 'award-table',
      rowIndex: row.rowIndex,
      sourceRecordId: record.recordId,
      values: row.fields.map((field) => ({
        targetId: field.targetId,
        value: '演示',
        evidenceFields: ['获奖名称'],
        confidence: 0.9,
        needsReview: false,
        reason: '字段语义一致',
      })),
    }],
    reviewItems: [{
      reviewId: 'review-row',
      targetId: row.fields[0].targetId,
      actionId: 'fill-row',
      message: '演示确认项',
    }],
  };
}

const merged = mergeAgentChunkPlans(
  large.slice(0, 2),
  [chunkPlan(0), chunkPlan(1)],
  'full-snapshot',
  'full-profile',
);
assert.equal(merged.snapshotFingerprint, 'full-snapshot');
assert.equal(merged.profileFingerprint, 'full-profile');
assert.deepEqual(merged.actions.map((action) => action.actionId), [
  'chunk_0:fill-row',
  'chunk_1:fill-row',
]);
assert.deepEqual(merged.reviewItems.map((item) => item.reviewId), [
  'chunk_0:review-row',
  'chunk_1:review-row',
]);
assert.deepEqual(merged.reviewItems.map((item) => item.actionId), [
  'chunk_0:fill-row',
  'chunk_1:fill-row',
]);

console.log('agent planner chunk tests passed');
