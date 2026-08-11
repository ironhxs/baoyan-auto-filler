import assert from 'node:assert/strict';

import { buildAgentBatchProgressView } from '../utils/agent/batch-view';
import type { ApplicationRunnerCheckpoint } from '../utils/page-analysis';

const base: ApplicationRunnerCheckpoint = {
  status: 'running',
  history: [],
  updatedAt: 1,
};

assert.equal(buildAgentBatchProgressView(base), null);
assert.deepEqual(buildAgentBatchProgressView({ ...base, batchPhase: 'collecting' }), {
  label: '跨页收集中',
  pageCount: 0,
  tone: 'neutral',
});
assert.deepEqual(buildAgentBatchProgressView({
  ...base,
  batchPhase: 'planning',
  batchBlueprint: {
    version: 1,
    applicationId: 'application-1',
    fingerprint: 'fp',
    pages: [{
      snapshot: {
        pageKey: 'a', url: 'https://example.test/a', title: 'A', stepText: 'A',
        instructions: [], groups: [], capturedAt: 1,
      },
      sourceRecords: [],
    }, {
      snapshot: {
        pageKey: 'b', url: 'https://example.test/b', title: 'B', stepText: 'B',
        instructions: [], groups: [], capturedAt: 2,
      },
      sourceRecords: [],
    }],
    capturedAt: 2,
  },
}), {
  label: '正在综合规划',
  pageCount: 2,
  tone: 'active',
});
assert.equal(buildAgentBatchProgressView({ ...base, batchPhase: 'executing' })?.label, '跨页计划已启用');
assert.equal(buildAgentBatchProgressView({ ...base, batchPhase: 'review' })?.tone, 'warning');

console.log('agent batch view tests passed');
