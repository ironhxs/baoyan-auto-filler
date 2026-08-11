import assert from 'node:assert/strict';

import {
  buildAgentBatchPlannerPrompt,
  createAgentBatchBlueprint,
} from '../utils/agent/batch-prompt';
import { parseAgentBatchPlan } from '../utils/agent/batch-response';
import { requestAgentBatchPlan } from '../utils/agent/batch-planner';
import { agentFingerprint } from '../utils/agent/planner';
import type { AgentBatchPageInput } from '../utils/agent/batch-types';
import type { AgentPageSnapshot } from '../utils/agent/types';
import type { ApiConfig } from '../utils/storage';

function page(pageKey: string, title: string, instruction: string, sourceLabel: string): AgentBatchPageInput {
  const snapshot: AgentPageSnapshot = {
    pageKey,
    url: `https://example.test/${pageKey}`,
    title,
    stepText: title,
    instructions: [instruction],
    visiblePageText: [title, instruction],
    capturedAt: 1,
    groups: [{
      groupId: `${pageKey}-group`,
      label: title,
      kind: 'single',
      columns: [],
      rows: [],
      fields: [{
        targetId: `${pageKey}-target`,
        index: 0,
        label: title,
        currentValue: '',
        required: false,
        protected: false,
        kind: 'text',
        options: [],
        placeholder: '',
        formatHints: [],
        forbiddenCharacters: instruction.includes('#') ? ['|', '#'] : [],
      }],
    }],
  };
  return {
    snapshot,
    sourceRecords: [{
      recordId: `${pageKey}:0`,
      categoryId: pageKey,
      categoryLabel: sourceLabel,
      itemIndex: 0,
      fields: { 名称: sourceLabel, Cookie: 'secret-session' },
      searchText: sourceLabel,
    }],
    fileRecordIds: [],
  };
}

const pages = [
  page('academic', '学术成果', '包括科研训练、论文、专利和学科竞赛，内容中不得含有 |、#', 'PRISM-Net'),
  page('honor', '何时何地何原因受过何种奖励', '只填写荣誉奖励，不重复学科竞赛', '一等奖学金'),
];
const blueprint = createAgentBatchBlueprint('application-1', pages, 123);
const prompt = buildAgentBatchPlannerPrompt(blueprint);

assert.equal(blueprint.pages.length, 2);
assert.equal(blueprint.capturedAt, 123);
assert.match(prompt, /学术成果/u);
assert.match(prompt, /何时何地何原因受过何种奖励/u);
assert.match(prompt, /不得含有 \|、#/u);
assert.match(prompt, /跨页分配/u);
assert.equal(prompt.includes('secret-session'), false, 'batch prompts must filter credential-like fields');

const rawPlan = {
  version: 1,
  blueprintFingerprint: blueprint.fingerprint,
  pagePlans: blueprint.pages.map(({ snapshot, sourceRecords }) => ({
    version: 1,
    pageKey: snapshot.pageKey,
    snapshotFingerprint: agentFingerprint(snapshot),
    profileFingerprint: agentFingerprint(sourceRecords),
    actions: [],
    reviewItems: [],
  })),
  reviewItems: [],
};

const parsed = parseAgentBatchPlan(JSON.stringify(rawPlan), blueprint);
assert.deepEqual(parsed.pagePlans.map((plan) => plan.pageKey), ['academic', 'honor']);

assert.throws(() => parseAgentBatchPlan(JSON.stringify({
  ...rawPlan,
  pagePlans: [rawPlan.pagePlans[0], rawPlan.pagePlans[0]],
}), blueprint), /duplicate pageKey|missing pageKey/u);

let calls = 0;
const requested = await requestAgentBatchPlan(blueprint, {} as ApiConfig, {
  requestText: async () => {
    calls += 1;
    return calls === 1 ? '{invalid-json' : JSON.stringify(rawPlan);
  },
});
assert.equal(calls, 2, 'one invalid batch response may be repaired once');
assert.deepEqual(requested.pagePlans.map((plan) => plan.pageKey), ['academic', 'honor']);

console.log('agent batch planning tests passed');
