import assert from 'node:assert/strict';

import { getRequestBody, requestModelText } from '../utils/matcher';
import {
  agentFingerprint,
  requestAgentPagePlan,
} from '../utils/agent/planner';
import { BAOTIAN_PAGE_PLAN_SCHEMA } from '../utils/agent/planner-prompt';
import type { AgentPageSnapshot } from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';
import type { ApiConfig } from '../utils/storage';

const responsesConfig: ApiConfig = {
  baseUrl: 'https://relay.example/v1',
  apiKey: 'test-key-never-sent',
  model: 'gpt-5.6',
  providerId: 'custom',
  apiMode: 'responses',
  fastMode: true,
  aiEnhanced: true,
};

const chatConfig: ApiConfig = {
  ...responsesConfig,
  apiMode: 'chat_completions',
  fastMode: false,
};

const responsesBody = getRequestBody(responsesConfig, 'plan the page', {
  stream: false,
  jsonSchema: BAOTIAN_PAGE_PLAN_SCHEMA,
}) as Record<string, any>;
assert.equal(responsesBody.model, 'gpt-5.6');
assert.equal(responsesBody.store, false);
assert.equal(responsesBody.service_tier, 'fast');
assert.equal(responsesBody.text.format.type, 'json_schema');
assert.equal(responsesBody.text.format.name, 'baotian_page_plan');
assert.equal(responsesBody.text.format.strict, true);
assert.equal('messages' in responsesBody, false);

const chatBody = getRequestBody(chatConfig, 'plan the page', {
  stream: false,
  jsonSchema: BAOTIAN_PAGE_PLAN_SCHEMA,
}) as Record<string, any>;
assert.equal(Array.isArray(chatBody.messages), true);
assert.equal(chatBody.response_format.type, 'json_schema');
assert.equal(chatBody.response_format.json_schema.name, 'baotian_page_plan');
assert.equal('service_tier' in chatBody, false);

const snapshot: AgentPageSnapshot = {
  pageKey: 'basic',
  url: 'https://example.test/basic',
  title: '基本信息',
  stepText: '第1步',
  instructions: [],
  capturedAt: 1,
  groups: [{
    groupId: 'basic',
    label: '基本信息',
    kind: 'single',
    columns: [],
    rows: [],
    fields: [{
      targetId: 'name-target', index: 0, label: '姓名', currentValue: '', required: true,
      protected: false, kind: 'text', options: [], placeholder: '', formatHints: [], forbiddenCharacters: [],
    }],
  }],
};
const records: AgentSourceRecord[] = [{
  recordId: 'basic_fields:0',
  categoryId: 'basic_fields',
  categoryLabel: '基本资料',
  itemIndex: 0,
  fields: { 姓名: '测试同学' },
  searchText: '姓名: 测试同学',
}];

const planObject = {
  version: 1,
  pageKey: snapshot.pageKey,
  snapshotFingerprint: agentFingerprint(snapshot),
  profileFingerprint: agentFingerprint(records),
  actions: [{
    actionId: 'fill-name',
    type: 'fill_field',
    targetId: 'name-target',
    sourceRecordId: 'basic_fields:0',
    value: '测试同学',
    evidenceFields: ['姓名'],
    confidence: 1,
    needsReview: false,
    reason: '资料直接对应',
  }],
  reviewItems: [],
};

const originalFetch = globalThis.fetch;
try {
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'unsupported parameter: text.format json_schema' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ output_text: JSON.stringify(planObject) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const plan = await requestAgentPagePlan({ snapshot, sourceRecords: records }, responsesConfig);
  assert.equal(plan.actions.length, 1);
  assert.equal(requests.length, 2, 'unsupported structured output must fall back exactly once');
  assert.equal('text' in requests[0], true);
  assert.equal('text' in requests[1], false, 'fallback must request plain JSON without structured-output parameters');

  for (const status of [401, 403, 429, 502]) {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: `status ${status}` } }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    };
    await assert.rejects(
      () => requestAgentPagePlan({ snapshot, sourceRecords: records }, responsesConfig),
      new RegExp(`LLM API error ${status}`),
    );
    assert.equal(attempts, 1, `HTTP ${status} must not switch API modes or retry`);
  }

  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new TypeError('network down');
  };
  await assert.rejects(
    () => requestAgentPagePlan({ snapshot, sourceRecords: records }, responsesConfig),
    /network down/,
  );
  assert.equal(networkAttempts, 1, 'network errors must not trigger a second mode');

  let receivedSignal = false;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal instanceof AbortSignal;
    return new Response(JSON.stringify({ output_text: JSON.stringify(planObject) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await requestModelText(responsesConfig, 'timeout probe', { timeoutMs: 20 });
  assert.equal(receivedSignal, true, 'model requests must be abortable');

  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(
    () => requestModelText(responsesConfig, 'timeout probe', { timeoutMs: 10 }),
    /LLM API 请求超过 1 秒，已安全暂停/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('agent API tests passed');
