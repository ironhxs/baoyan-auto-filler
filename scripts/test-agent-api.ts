import assert from 'node:assert/strict';

import { getRequestBody, requestModelText } from '../utils/matcher';
import {
  agentFingerprint,
  requestAgentPagePlan,
} from '../utils/agent/planner';
import { BAOTIAN_PAGE_PLAN_SCHEMA, buildAgentPlannerPrompt } from '../utils/agent/planner-prompt';
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

const naturalCompositionPrompt = buildAgentPlannerPrompt({
  snapshot,
  sourceRecords: records,
  snapshotFingerprint: agentFingerprint(snapshot),
  profileFingerprint: agentFingerprint(records),
});
assert.match(naturalCompositionPrompt, /先理解整道题和同一行各列的分工/);
assert.match(naturalCompositionPrompt, /不要套用固定的括号拼接模板/);
assert.match(naturalCompositionPrompt, /避免重复已经写入同一行其他列的信息/);
assert.match(naturalCompositionPrompt, /先判断名称表示项目、作品、团队、个人奖项还是荣誉称号/);
assert.match(naturalCompositionPrompt, /队名不要强行添加“项目”/);
assert.match(naturalCompositionPrompt, /发表刊物或出版社/);
assert.match(naturalCompositionPrompt, /科研训练.*项目级别.*项目名称.*排名/s);
assert.match(naturalCompositionPrompt, /学科竞赛.*竞赛名称.*获奖项目名称.*获奖人/s);

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
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    const wirePageKey = String(body.input ?? '').match(/"pageKey":"(page_fp_[^"]+)"/)?.[1] ?? '';
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ ...planObject, pageKey: wirePageKey }),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const plan = await requestAgentPagePlan({ snapshot, sourceRecords: records }, responsesConfig);
  assert.equal(plan.actions.length, 1);
  assert.equal(requests.length, 1, 'Agent planning must use one relay request');
  assert.equal('text' in requests[0], false, 'Agent planning must avoid relay-side structured output');
  assert.equal(requests[0].stream, true, 'Agent planning must stream so MV3 receives response headers promptly');
  assert.match(
    String(requests[0].input ?? ''),
    /输出 JSON Schema/,
    'plain JSON planning must include the strict schema for local validation',
  );

  let semanticPlanAttempts = 0;
  const repairedPlan = await requestAgentPagePlan(
    { snapshot, sourceRecords: records },
    responsesConfig,
    {
      requestText: async (_config, prompt) => {
        semanticPlanAttempts += 1;
        const wirePageKey = prompt.match(/"pageKey":"(page_fp_[^"]+)"/)?.[1] ?? '';
        return JSON.stringify({
          ...planObject,
          pageKey: wirePageKey,
          actions: [{
            ...planObject.actions[0],
            sourceRecordId: semanticPlanAttempts === 1 ? 'missing-record:9' : 'basic_fields:0',
          }],
        });
      },
    },
  );
  assert.equal(semanticPlanAttempts, 2, 'a semantically invalid model plan must receive one focused repair attempt');
  assert.equal(repairedPlan.actions[0].type, 'fill_field');

  const longPageKeySnapshot: AgentPageSnapshot = {
    ...snapshot,
    pageKey: `https://example.test/form::${'INPUT::|'.repeat(80)}`,
  };
  let longKeyPrompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input?: string };
    longKeyPrompt = body.input ?? '';
    const wirePageKey = longKeyPrompt.match(/"pageKey":"(page_fp_[^"]+)"/)?.[1] ?? 'missing-page-alias';
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        version: 1,
        pageKey: wirePageKey,
        snapshotFingerprint: agentFingerprint(longPageKeySnapshot),
        profileFingerprint: agentFingerprint(records),
        actions: [],
        reviewItems: [],
      }),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const longKeyPlan = await requestAgentPagePlan({
    snapshot: longPageKeySnapshot,
    sourceRecords: records,
  }, responsesConfig);
  assert.equal(longKeyPlan.pageKey, longPageKeySnapshot.pageKey, 'the full local page key must be restored after validation');
  assert.equal(longKeyPrompt.includes(longPageKeySnapshot.pageKey), false, 'the relay prompt must use a compact page alias');

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

  const largeRows = Array.from({ length: 18 }, (_, rowIndex) => ({
    rowIndex,
    fields: ['时间', '地点', '内容'].map((label, columnIndex) => ({
      targetId: `large:${rowIndex}:${columnIndex}`,
      index: rowIndex * 3 + columnIndex,
      rowIndex,
      columnId: `column-${columnIndex}`,
      label,
      currentValue: '',
      required: true,
      protected: false,
      kind: 'text' as const,
      options: [],
      placeholder: '',
      formatHints: [],
      forbiddenCharacters: [],
    })),
  }));
  const largeSnapshot: AgentPageSnapshot = {
    ...snapshot,
    pageKey: 'large-award-page',
    title: '奖励情况',
    groups: [{
      groupId: 'large-awards',
      label: '奖励情况',
      kind: 'repeatable',
      columns: [
        { columnId: 'column-0', label: '时间' },
        { columnId: 'column-1', label: '地点' },
        { columnId: 'column-2', label: '内容' },
      ],
      rows: largeRows,
      fields: largeRows.flatMap((row) => row.fields),
    }],
  };
  const largeRecords: AgentSourceRecord[] = Array.from({ length: 18 }, (_, index) => ({
    recordId: `honors_awards:${index}`,
    categoryId: 'honors_awards',
    categoryLabel: '荣誉奖励',
    itemIndex: index,
    fields: { 获奖名称: `奖励 ${index + 1}` },
    searchText: `奖励 ${index + 1}`,
  }));
  let chunkRequests = 0;
  globalThis.fetch = async (_input, init) => {
    chunkRequests += 1;
    const body = JSON.parse(String(init?.body)) as { input?: string };
    const prompt = body.input ?? '';
    const pageKey = prompt.match(/"pageKey":"(page_fp_[^"]+)"/)?.[1] ?? '';
    const snapshotFingerprint = prompt.match(/snapshotFingerprint=(fp_[a-z0-9]+)/)?.[1] ?? '';
    const profileFingerprint = prompt.match(/profileFingerprint=(fp_[a-z0-9]+)/)?.[1] ?? '';
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        version: 1,
        pageKey,
        snapshotFingerprint,
        profileFingerprint,
        actions: [],
        reviewItems: [],
      }),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const chunkProgress: Array<[number, number]> = [];
  const largePlan = await requestAgentPagePlan({
    snapshot: largeSnapshot,
    sourceRecords: largeRecords,
  }, responsesConfig, {
    onChunkProgress: (completed, total) => { chunkProgress.push([completed, total]); },
  });
  assert.equal(chunkRequests, 9, 'large repeatable pages must stay within relay-safe two-row chunks');
  assert.deepEqual(chunkProgress, Array.from({ length: 9 }, (_, index) => [index + 1, 9]));
  assert.equal(largePlan.snapshotFingerprint, agentFingerprint(largeSnapshot));
  assert.equal(largePlan.profileFingerprint, agentFingerprint(largeRecords));

  const savedChunks = new Map<string, any>();
  let durableChunkRequests = 0;
  const durableRequest = async (_config: ApiConfig, prompt: string): Promise<string> => {
    durableChunkRequests += 1;
    if (durableChunkRequests === 3) throw new Error('relay overloaded');
    return JSON.stringify({
      version: 1,
      pageKey: prompt.match(/"pageKey":"(page_fp_[^"]+)"/)?.[1] ?? '',
      snapshotFingerprint: prompt.match(/snapshotFingerprint=(fp_[a-z0-9]+)/)?.[1] ?? '',
      profileFingerprint: prompt.match(/profileFingerprint=(fp_[a-z0-9]+)/)?.[1] ?? '',
      actions: [],
      reviewItems: [],
    });
  };
  const durableOptions = {
    requestText: durableRequest,
    loadChunkPlan: async (chunk: { chunkId: string }) => savedChunks.get(chunk.chunkId) ?? null,
    saveChunkPlan: async (chunk: { chunkId: string }, chunkPlan: unknown) => {
      savedChunks.set(chunk.chunkId, structuredClone(chunkPlan));
    },
  };
  await assert.rejects(
    () => requestAgentPagePlan({ snapshot: largeSnapshot, sourceRecords: largeRecords }, responsesConfig, durableOptions),
    /relay overloaded/,
  );
  assert.equal(savedChunks.size, 2, 'completed planning chunks must be saved before a later relay failure');
  const resumedLargePlan = await requestAgentPagePlan(
    { snapshot: largeSnapshot, sourceRecords: largeRecords },
    responsesConfig,
    durableOptions,
  );
  assert.equal(resumedLargePlan.actions.length, 0);
  assert.equal(durableChunkRequests, 10, 'resuming nine chunks after the third request fails must reuse the first two chunks');
  assert.equal(savedChunks.size, 9);

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
