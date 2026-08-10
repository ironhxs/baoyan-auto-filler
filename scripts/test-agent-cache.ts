import assert from 'node:assert/strict';

import {
  AGENT_PROTOCOL_VERSION,
  cloneAgentCheckpoint,
  createAgentPlanCacheKey,
  nextPendingAgentActionIndex,
  serializeAgentPlanCacheIdentity,
  updateAgentCheckpoint,
} from '../utils/agent/cache';
import type { AgentCheckpoint, AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';
import type { ApiConfig } from '../utils/storage';

assert.equal(AGENT_PROTOCOL_VERSION, 7, 'snapshot, retrieval, and planning semantics changed, so cached older plans must not be reused');

const snapshot: AgentPageSnapshot = {
  pageKey: 'page-1', url: 'https://example.test', title: '基本信息', stepText: '', instructions: [], capturedAt: 1,
  groups: [{
    groupId: 'basic', label: '基本信息', kind: 'single', columns: [], rows: [],
    fields: [{
      targetId: 'name', index: 0, label: '姓名', currentValue: '', required: true, protected: false,
      kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [],
    }],
  }],
};
const records: AgentSourceRecord[] = [{
  recordId: 'basic:0', categoryId: 'basic', categoryLabel: '基本资料', itemIndex: 0,
  fields: { 姓名: '测试同学' }, searchText: '姓名: 测试同学',
}];
const config: ApiConfig = {
  baseUrl: 'https://relay.example/v1', apiKey: 'secret-a', model: 'gpt-5.6', providerId: 'custom',
  apiMode: 'responses', fastMode: true, aiEnhanced: true,
};

const baseInput = { snapshot, sourceRecords: records, apiConfig: config, protocolVersion: AGENT_PROTOCOL_VERSION };
const key = createAgentPlanCacheKey(baseInput);
assert.equal(createAgentPlanCacheKey({ ...baseInput, apiConfig: { ...config, apiKey: 'secret-b' } }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, snapshot: {
  ...snapshot,
  groups: [{ ...snapshot.groups[0], fields: [{ ...snapshot.groups[0].fields[0], label: '真实姓名' }] }],
} }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, sourceRecords: [{ ...records[0], fields: { 姓名: '另一位同学' } }] }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, apiConfig: { ...config, model: 'gpt-5.6-terra' } }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, apiConfig: { ...config, apiMode: 'chat_completions' } }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, apiConfig: { ...config, fastMode: false } }), key);
assert.notEqual(createAgentPlanCacheKey({ ...baseInput, protocolVersion: AGENT_PROTOCOL_VERSION + 1 }), key);
assert.equal(serializeAgentPlanCacheIdentity(baseInput).includes('secret-a'), false);
assert.equal(serializeAgentPlanCacheIdentity(baseInput).includes('apiKey'), false);

const plan: AgentPagePlan = {
  version: 1, pageKey: snapshot.pageKey, snapshotFingerprint: 's1', profileFingerprint: 'p1', reviewItems: [],
  actions: [
    { actionId: 'a1', type: 'fill_field', targetId: 'name', sourceRecordId: 'basic:0', value: '测试同学', evidenceFields: ['姓名'], confidence: 1, needsReview: false, reason: '直接对应' },
    { actionId: 'a2', type: 'fill_field', targetId: 'name-2', sourceRecordId: 'basic:0', value: 'test@example.com', evidenceFields: ['姓名'], confidence: 0.6, needsReview: true, reason: '示例' },
  ],
};
const checkpoint: AgentCheckpoint = {
  pageKey: snapshot.pageKey,
  phase: 'executing',
  plan,
  nextActionIndex: 0,
  results: [{ actionId: 'a1', targetId: 'name', status: 'verified', observed: '测试同学', reason: '一致', updatedAt: 10 }],
  retries: { a2: 1 },
  manualOverrides: { manual: '用户值' },
  updatedAt: 10,
};

assert.equal(nextPendingAgentActionIndex(checkpoint), 1, 'verified actions must not replay after service worker sleep');
const serialized = JSON.stringify(checkpoint);
const restored = JSON.parse(serialized) as AgentCheckpoint;
assert.equal(nextPendingAgentActionIndex(restored), 1);

const updated = updateAgentCheckpoint(restored, {
  phase: 'verifying',
  results: [...restored.results, { actionId: 'a2', targetId: 'name-2', status: 'manual', observed: '用户值', reason: '人工保留', updatedAt: 20 }],
  updatedAt: 20,
});
assert.equal(nextPendingAgentActionIndex(updated), 2);
assert.equal(updated.phase, 'verifying');

const cloned = cloneAgentCheckpoint(updated);
cloned.results[0].observed = '被修改';
cloned.retries.a2 = 99;
cloned.manualOverrides.manual = '被修改';
if (cloned.plan?.actions[0].type === 'fill_field') cloned.plan.actions[0].value = '被修改';
assert.equal(updated.results[0].observed, '测试同学');
assert.equal(updated.retries.a2, 1);
assert.equal(updated.manualOverrides.manual, '用户值');
if (updated.plan?.actions[0].type === 'fill_field') assert.equal(updated.plan.actions[0].value, '测试同学');

console.log('agent cache and checkpoint tests passed');
