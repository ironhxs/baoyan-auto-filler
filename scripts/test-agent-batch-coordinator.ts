import assert from 'node:assert/strict';

import { coordinateAgentBatchPlanning } from '../utils/agent/batch-coordinator';
import { agentFingerprint } from '../utils/agent/planner';
import type { AgentBatchBlueprint, AgentBatchPageInput, AgentBatchPlan } from '../utils/agent/batch-types';
import type { AgentPageSnapshot } from '../utils/agent/types';

function page(pageKey: string, capturedAt: number, stepText = pageKey): AgentBatchPageInput {
  const snapshot: AgentPageSnapshot = {
    pageKey,
    url: `https://example.test/${pageKey}`,
    title: '测试报名系统',
    stepText,
    instructions: [],
    groups: [],
    capturedAt,
  };
  return {
    snapshot,
    sourceRecords: [{
      recordId: `${pageKey}:0`,
      categoryId: pageKey,
      categoryLabel: pageKey,
      itemIndex: 0,
      fields: { 名称: pageKey },
      searchText: `名称: ${pageKey}`,
    }],
  };
}

function planFor(blueprint: AgentBatchBlueprint): AgentBatchPlan {
  return {
    version: 1,
    blueprintFingerprint: blueprint.fingerprint,
    pagePlans: blueprint.pages.map((input) => ({
      version: 1,
      pageKey: input.snapshot.pageKey,
      snapshotFingerprint: agentFingerprint(input.snapshot),
      profileFingerprint: agentFingerprint(input.sourceRecords),
      actions: [],
      reviewItems: [],
    })),
    reviewItems: [],
  };
}

let requests = 0;
const requestPlan = async (blueprint: AgentBatchBlueprint): Promise<AgentBatchPlan> => {
  requests += 1;
  return planFor(blueprint);
};

const single = await coordinateAgentBatchPlanning({
  applicationId: 'application-1',
  pages: [page('basic', 1)],
  currentPageKey: 'basic',
  capturedAt: 10,
}, { requestPlan });
assert.equal(single.phase, 'collecting');
assert.equal(single.currentPagePlan, null);
assert.equal(requests, 0, 'one collected page must not trigger a fake cross-page model call');

const first = await coordinateAgentBatchPlanning({
  applicationId: 'application-1',
  pages: [page('basic', 1), page('academic', 2)],
  currentPageKey: 'academic',
  capturedAt: 20,
}, { requestPlan });
assert.equal(first.phase, 'executing');
assert.equal(first.currentPagePlan?.pageKey, 'academic');
assert.equal(first.planned, true);
assert.equal(requests, 1);

const reused = await coordinateAgentBatchPlanning({
  applicationId: 'application-1',
  pages: [page('basic', 1), page('academic', 2)],
  currentPageKey: 'academic',
  existingBlueprint: first.blueprint,
  existingPlan: first.plan,
  capturedAt: 30,
}, { requestPlan });
assert.equal(reused.planned, false);
assert.equal(reused.currentPagePlan?.pageKey, 'academic');
assert.equal(requests, 1, 'an unchanged cross-page blueprint must reuse the existing plan');

const changed = await coordinateAgentBatchPlanning({
  applicationId: 'application-1',
  pages: [page('basic', 1), page('academic', 3, '学术成果结构已变化')],
  currentPageKey: 'academic',
  existingBlueprint: first.blueprint,
  existingPlan: first.plan,
  capturedAt: 40,
}, { requestPlan });
assert.equal(changed.planned, true);
assert.equal(requests, 2, 'a changed page snapshot must invalidate the prior batch blueprint');

console.log('agent batch coordinator tests passed');
