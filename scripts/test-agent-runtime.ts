import assert from 'node:assert/strict';

import { runAgentPage } from '../utils/agent/runtime';
import type { AgentRuntimeDeps, AgentValidatedRunPlan } from '../utils/agent/runtime';
import type { AgentCheckpoint, AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';

function fixture(pageKey = 'page-1'): {
  snapshot: AgentPageSnapshot;
  records: AgentSourceRecord[];
  plan: AgentPagePlan;
} {
  const snapshot: AgentPageSnapshot = {
    pageKey, url: `https://example.test/${pageKey}`, title: '基本信息', stepText: '', instructions: [], capturedAt: 1,
    groups: [{
      groupId: 'basic', label: '基本信息', kind: 'single', columns: [], rows: [],
      fields: [
        { targetId: 't1', index: 0, label: '姓名', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
        { targetId: 't2', index: 1, label: '邮箱', currentValue: '', required: true, protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [] },
      ],
    }],
  };
  const records: AgentSourceRecord[] = [{
    recordId: 'basic:0', categoryId: 'basic', categoryLabel: '基本资料', itemIndex: 0,
    fields: { 姓名: '测试同学', 邮箱: 'test@example.com' }, searchText: '',
  }];
  const plan: AgentPagePlan = {
    version: 1, pageKey, snapshotFingerprint: 's', profileFingerprint: 'p', reviewItems: [],
    actions: [
      { actionId: 'a1', type: 'fill_field', targetId: 't1', sourceRecordId: 'basic:0', value: '测试同学', evidenceFields: ['姓名'], confidence: 1, needsReview: false, reason: '姓名' },
      { actionId: 'a2', type: 'fill_field', targetId: 't2', sourceRecordId: 'basic:0', value: 'test@example.com', evidenceFields: ['邮箱'], confidence: 1, needsReview: false, reason: '邮箱' },
    ],
  };
  return { snapshot, records, plan };
}

function validated(plan: AgentPagePlan): AgentValidatedRunPlan {
  return {
    plan,
    executableActions: plan.actions,
    reviewItems: [],
    manualTargets: [],
    rejectedActionIds: [],
  };
}

{
  const { snapshot, records, plan } = fixture();
  const phases: string[] = [];
  const executed: string[][] = [];
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => plan,
    validate: (value) => validated(value),
    execute: async (value) => {
      executed.push(value.executableActions.map((action) => action.actionId));
      return {
        results: value.executableActions.map((action) => ({
          actionId: action.actionId,
          targetId: action.type === 'fill_field' ? action.targetId : undefined,
          status: 'verified' as const,
          observed: action.type === 'fill_field' ? action.value : '',
          reason: '一致',
          updatedAt: 10,
        })),
      };
    },
    verify: async (_value, report) => ({
      results: report.results,
      complete: true,
      needsRepair: false,
      failedActionIds: [],
      canAdvance: true,
    }),
    save: async (checkpoint) => { phases.push(checkpoint.phase); },
  };
  const outcome = await runAgentPage(deps);
  assert.equal(outcome.status, 'complete');
  assert.deepEqual(phases, ['observing', 'planning', 'validating', 'executing', 'verifying', 'complete']);
  assert.deepEqual(executed, [['a1', 'a2']]);
}

{
  const { snapshot, records, plan } = fixture();
  const resumed: AgentCheckpoint = {
    pageKey: snapshot.pageKey,
    phase: 'executing',
    plan,
    nextActionIndex: 1,
    results: [{ actionId: 'a1', targetId: 't1', status: 'verified', observed: '测试同学', reason: '一致', updatedAt: 1 }],
    retries: {}, manualOverrides: {}, updatedAt: 1,
  };
  const executed: string[][] = [];
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => { throw new Error('cached plan should be reused'); },
    validate: (value) => validated(value),
    execute: async (value) => {
      executed.push(value.executableActions.map((action) => action.actionId));
      return { results: [{ actionId: 'a2', targetId: 't2', status: 'verified', observed: 'test@example.com', reason: '一致', updatedAt: 2 }] };
    },
    verify: async (_value, report) => ({ results: report.results, complete: true, needsRepair: false, failedActionIds: [], canAdvance: true }),
    save: async () => undefined,
  };
  const outcome = await runAgentPage(deps, resumed);
  assert.equal(outcome.status, 'complete');
  assert.deepEqual(executed, [['a2']], 'verified action a1 must not replay');
}

{
  const { snapshot, records, plan } = fixture();
  let attempts = 0;
  const phases: string[] = [];
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => plan,
    validate: (value) => validated(value),
    execute: async (value) => {
      attempts += 1;
      return { results: value.executableActions.map((action) => ({
        actionId: action.actionId,
        targetId: action.type === 'fill_field' ? action.targetId : undefined,
        status: 'failed' as const,
        observed: '', reason: '回读为空', retryable: true, updatedAt: attempts,
      })) };
    },
    verify: async (_value, report) => ({
      results: report.results, complete: false, needsRepair: true,
      failedActionIds: report.results.map((result) => result.actionId), canAdvance: false,
    }),
    save: async (checkpoint) => { phases.push(checkpoint.phase); },
  };
  const outcome = await runAgentPage(deps);
  assert.equal(outcome.status, 'paused');
  assert.equal(attempts, 3, 'initial attempt plus two repairs is the hard maximum');
  assert.equal(phases.filter((phase) => phase === 'repairing').length, 2);
}

{
  const { snapshot, records } = fixture();
  const preserved = [{ actionId: 'local', targetId: 'local-field', status: 'verified' as const, observed: '本地值', reason: '本地一致', updatedAt: 1 }];
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => { throw new Error('LLM API error 502: upstream'); },
    validate: (value) => validated(value),
    execute: async () => ({ results: [] }),
    verify: async () => ({ results: [], complete: false, needsRepair: false, failedActionIds: [], canAdvance: false }),
    save: async () => undefined,
  };
  const outcome = await runAgentPage(deps, {
    pageKey: snapshot.pageKey, phase: 'observing', nextActionIndex: 0,
    results: preserved, retries: {}, manualOverrides: {}, updatedAt: 1,
  });
  assert.equal(outcome.status, 'paused');
  assert.match(outcome.reason ?? '', /502/);
  assert.equal(outcome.checkpoint.results[0].status, 'verified');
}

{
  const old = fixture('old-page');
  const current = fixture('new-page');
  let planned = 0;
  const deps: AgentRuntimeDeps = {
    observe: async () => current.snapshot,
    retrieve: async () => current.records,
    plan: async () => { planned += 1; return current.plan; },
    validate: (value) => validated(value),
    execute: async (value) => ({ results: value.executableActions.map((action) => ({ actionId: action.actionId, targetId: action.type === 'fill_field' ? action.targetId : undefined, status: 'verified' as const, observed: '', reason: '一致', updatedAt: 2 })) }),
    verify: async (_value, report) => ({ results: report.results, complete: true, needsRepair: false, failedActionIds: [], canAdvance: true }),
    save: async () => undefined,
  };
  const outcome = await runAgentPage(deps, {
    pageKey: old.snapshot.pageKey, phase: 'executing', plan: old.plan, nextActionIndex: 1,
    results: [{ actionId: 'old', status: 'verified', observed: 'old', reason: 'old', updatedAt: 1 }],
    retries: { old: 1 }, manualOverrides: { old: 'old' }, updatedAt: 1,
  });
  assert.equal(outcome.status, 'complete');
  assert.equal(planned, 1, 'page signature changes must invalidate the old plan');
  assert.equal(outcome.checkpoint.pageKey, 'new-page');
  assert.equal(outcome.checkpoint.results.some((result) => result.actionId === 'old'), false);
}

{
  const { snapshot, records, plan } = fixture('review-page');
  plan.actions = [];
  plan.reviewItems = [{
    reviewId: 'review-1',
    targetId: 't1',
    message: '页面字段含义不明确，需要人工确认',
  }];
  let executed = false;
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => plan,
    validate: (value) => ({
      ...validated(value),
      reviewItems: value.reviewItems,
    }),
    execute: async () => {
      executed = true;
      return { results: [] };
    },
    verify: async () => ({
      results: [], complete: true, needsRepair: false, failedActionIds: [], canAdvance: true,
    }),
    save: async () => undefined,
  };
  const outcome = await runAgentPage(deps);
  assert.equal(outcome.status, 'paused', 'review-only plans must stop for manual confirmation');
  assert.equal(outcome.canAdvance, false);
  assert.equal(executed, false);
  assert.match(outcome.reason ?? '', /manual review/i);
}

{
  const { snapshot, records, plan } = fixture('filled-review-page');
  plan.reviewItems = [{
    reviewId: 'review-after-fill',
    targetId: 't2',
    message: '已填字段仍需人工核对',
  }];
  let executed = 0;
  const deps: AgentRuntimeDeps = {
    observe: async () => snapshot,
    retrieve: async () => records,
    plan: async () => plan,
    validate: (value) => ({
      ...validated(value),
      reviewItems: value.reviewItems,
    }),
    execute: async (value) => {
      executed += 1;
      return {
        results: value.executableActions.map((action) => ({
          actionId: action.actionId,
          targetId: action.type === 'fill_field' ? action.targetId : undefined,
          status: 'verified' as const,
          observed: action.type === 'fill_field' ? action.value : '',
          reason: 'readback matched',
          updatedAt: 1,
        })),
      };
    },
    verify: async (_value, report) => ({
      results: report.results, complete: true, needsRepair: false, failedActionIds: [], canAdvance: true,
    }),
    save: async () => undefined,
  };
  const outcome = await runAgentPage(deps);
  assert.equal(executed, 1, 'safe actions should still execute before review pause');
  assert.equal(outcome.status, 'paused', 'completed writes must not suppress outstanding review items');
  assert.equal(outcome.canAdvance, false);
}

console.log('agent runtime tests passed');
