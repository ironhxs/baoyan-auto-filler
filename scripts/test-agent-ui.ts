import assert from 'node:assert/strict';
import { buildAgentViewModel } from '../utils/agent/view-model';
import { applyAgentControl } from '../utils/agent/control';
import type { AgentActionResult, AgentCheckpoint } from '../utils/agent/types';

function result(
  actionId: string,
  status: AgentActionResult['status'],
  index: number,
): AgentActionResult {
  return {
    actionId,
    targetId: `target-${index}`,
    status,
    observed: `value-${index}`,
    reason: status === 'failed' ? 'controlled input did not accept the value' : 'readback matched',
    retryable: status === 'failed',
    updatedAt: 100 + index,
  };
}

const checkpoint: AgentCheckpoint = {
  pageKey: 'award-page',
  phase: 'paused',
  plan: {
    version: 1,
    pageKey: 'award-page',
    snapshotFingerprint: 'snapshot',
    profileFingerprint: 'profile',
    actions: [],
    reviewItems: [
      { reviewId: 'review-1', message: '请检查一条低置信度记录' },
      { reviewId: 'review-2', message: '请确认一份材料' },
    ],
  },
  nextActionIndex: 0,
  results: [
    ...Array.from({ length: 12 }, (_, index) => result(`verified-${index}`, 'verified', index)),
    result('manual-1', 'manual', 20),
    result('review-1', 'review', 21),
    result('failed-1', 'failed', 22),
  ],
  retries: { 'failed-1': 2 },
  manualOverrides: { 'target-20': '用户手动填写' },
  cached: true,
  error: 'API key sk-test-secret failed for 身份证 110101200001010015; password=abc123; raw response: hidden',
  updatedAt: 200,
};

const view = buildAgentViewModel(checkpoint);
assert.ok(view);
assert.equal(view.phaseLabel, '等待确认');
assert.equal(view.verified, 12);
assert.equal(view.manual, 1);
assert.equal(view.review, 1);
assert.equal(view.failed, 1);
assert.equal(view.pendingReview, 2);
assert.equal(view.cached, true);
assert.equal(view.retries, 2);
assert.equal(view.canRetry, true);
assert.equal(view.canAcceptManual, true);
assert.equal(view.canReplan, true);
assert.equal(view.error.includes('sk-test-secret'), false);
assert.equal(view.error.includes('110101200001010015'), false);
assert.equal(view.error.includes('abc123'), false);
assert.match(view.error, /已隐藏敏感信息/);

const active = buildAgentViewModel({ ...checkpoint, phase: 'executing', error: undefined });
assert.ok(active);
assert.equal(active.phaseLabel, '正在填写');
assert.equal(active.canRetry, false);
assert.equal(active.error, '');

assert.equal(buildAgentViewModel(undefined), null);

const retry = applyAgentControl(checkpoint, 'retry_failed', 300);
assert.equal(retry.phase, 'observing');
assert.equal(retry.error, undefined);
assert.equal(retry.results.some((item) => item.status === 'failed'), false);
assert.equal(retry.results.filter((item) => item.status === 'verified').length, 12);
assert.equal(retry.results.filter((item) => item.status === 'manual').length, 1);
assert.equal(retry.retries['failed-1'], 0);

const replan = applyAgentControl(checkpoint, 'replan_page', 400);
assert.equal(replan.phase, 'observing');
assert.equal(replan.plan, undefined);
assert.equal(replan.results.filter((item) => item.status === 'verified').length, 12);
assert.equal(replan.results.filter((item) => item.status === 'manual').length, 1);
assert.deepEqual(replan.manualOverrides, checkpoint.manualOverrides);

console.log('Agent UI view-model tests passed');
