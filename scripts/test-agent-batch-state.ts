import assert from 'node:assert/strict';

import {
  findReusableAgentBatchPagePlan,
  mergeAgentBatchPages,
  refreshAgentBatchPage,
} from '../utils/agent/batch-state';
import { createAgentBatchBlueprint } from '../utils/agent/batch-prompt';
import { agentFingerprint } from '../utils/agent/planner';
import type { AgentBatchPageInput, AgentBatchPlan } from '../utils/agent/batch-types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';

function snapshot(pageKey: string, capturedAt: number, label = pageKey): AgentPageSnapshot {
  return {
    pageKey,
    url: `https://example.test/${pageKey}`,
    title: '测试报名系统',
    stepText: label,
    instructions: [],
    groups: [{
      groupId: `${pageKey}-group`,
      label,
      kind: 'single',
      columns: [],
      rows: [],
      fields: [{
        targetId: `${pageKey}-field`,
        index: 0,
        label,
        currentValue: '',
        required: false,
        protected: false,
        kind: 'text',
        options: [],
        placeholder: '',
        formatHints: [],
        forbiddenCharacters: [],
      }],
    }],
    capturedAt,
  };
}

function source(recordId: string, value: string): AgentSourceRecord {
  return {
    recordId,
    categoryId: 'test',
    categoryLabel: '测试资料',
    itemIndex: 0,
    fields: { 名称: value },
    searchText: `名称: ${value}`,
  };
}

function pagePlan(input: AgentBatchPageInput): AgentPagePlan {
  return {
    version: 1,
    pageKey: input.snapshot.pageKey,
    snapshotFingerprint: agentFingerprint(input.snapshot),
    profileFingerprint: agentFingerprint(input.sourceRecords),
    actions: [],
    reviewItems: [],
  };
}

const oldA = { snapshot: snapshot('a', 1, '旧页面 A'), sourceRecords: [source('a:0', '旧资料')] };
const pageB = { snapshot: snapshot('b', 2, '页面 B'), sourceRecords: [source('b:0', '资料 B')] };
const newA = { snapshot: snapshot('a', 3, '新页面 A'), sourceRecords: [source('a:0', '新资料')] };

const merged = mergeAgentBatchPages([oldA, pageB, newA]);
assert.deepEqual(merged.map((page) => page.snapshot.pageKey), ['a', 'b']);
assert.equal(merged[0].snapshot.stepText, '新页面 A', 'newer observations replace stale pages without changing page order');

const blueprint = createAgentBatchBlueprint('application-1', [newA, pageB], 10);
const batchPlan: AgentBatchPlan = {
  version: 1,
  blueprintFingerprint: blueprint.fingerprint,
  pagePlans: blueprint.pages.map(pagePlan),
  reviewItems: [],
};

assert.equal(
  findReusableAgentBatchPagePlan(batchPlan, newA.snapshot, newA.sourceRecords)?.pageKey,
  'a',
  'a batch page plan is reusable only for the exact page and profile fingerprints',
);
assert.equal(findReusableAgentBatchPagePlan(batchPlan, snapshot('a', 4, '结构已变化'), newA.sourceRecords), null);
assert.equal(findReusableAgentBatchPagePlan(batchPlan, newA.snapshot, [source('a:0', '资料已变化')]), null);

const changedA = { snapshot: snapshot('a', 5, '动态新增后的页面 A'), sourceRecords: [source('a:0', '新资料')] };
const changedAPlan = pagePlan(changedA);
const refreshed = refreshAgentBatchPage(blueprint, batchPlan, changedA, changedAPlan, 20);
assert.notEqual(refreshed.blueprint.fingerprint, blueprint.fingerprint);
assert.equal(refreshed.plan.blueprintFingerprint, refreshed.blueprint.fingerprint);
assert.equal(refreshed.plan.pagePlans.find((plan) => plan.pageKey === 'a')?.snapshotFingerprint, changedAPlan.snapshotFingerprint);
assert.equal(refreshed.plan.pagePlans.find((plan) => plan.pageKey === 'b')?.pageKey, 'b');
assert.equal(blueprint.pages[0].snapshot.stepText, '新页面 A', 'refresh must not mutate the prior batch checkpoint');

console.log('agent batch state tests passed');
