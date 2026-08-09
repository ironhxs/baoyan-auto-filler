import assert from 'node:assert/strict';
import {
  extractResponseText,
  extractStreamError,
  extractStreamText,
  getAuditRequestBody,
  getRequestBody,
  getRequestUrl,
  requestAuditModel,
  isSemanticallyCompatibleMatch,
  matchFields,
} from '../utils/matcher.ts';

const baseConfig = {
  baseUrl: 'https://example.com/v1/',
  apiKey: 'test-key',
  model: 'test-model',
  providerId: '',
  fastMode: false,
};

const chatConfig = { ...baseConfig, apiMode: 'chat_completions' };
const responsesConfig = { ...baseConfig, apiMode: 'responses' };

assert.equal(getRequestUrl(chatConfig), 'https://example.com/v1/chat/completions');
assert.equal(getRequestUrl(responsesConfig), 'https://example.com/v1/responses');

assert.deepEqual(getRequestBody(chatConfig, 'hello', false), {
  model: 'test-model',
  stream: false,
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
});

assert.deepEqual(getRequestBody(responsesConfig, 'hello', true), {
  model: 'test-model',
  stream: true,
  input: 'hello',
  store: false,
});

assert.deepEqual(getRequestBody({ ...chatConfig, fastMode: true }, 'fast chat', false), {
  model: 'test-model',
  stream: false,
  service_tier: 'fast',
  messages: [{ role: 'user', content: 'fast chat' }],
  temperature: 0,
});

assert.deepEqual(getRequestBody({ ...responsesConfig, fastMode: true }, 'fast responses', false), {
  model: 'test-model',
  stream: false,
  service_tier: 'fast',
  input: 'fast responses',
  store: false,
});

const auditImage = {
  filename: 'transcript-page-1.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
  pageNumber: 1,
};
assert.deepEqual(getAuditRequestBody(responsesConfig, 'audit prompt', [auditImage]), {
  model: 'test-model',
  stream: false,
  input: [{
    role: 'user',
    content: [
      { type: 'input_text', text: 'audit prompt' },
      { type: 'input_image', image_url: auditImage.dataUrl },
    ],
  }],
  store: false,
});
assert.deepEqual(getAuditRequestBody(chatConfig, 'audit prompt', [auditImage]), {
  model: 'test-model',
  stream: false,
  messages: [{ role: 'user', content: 'audit prompt' }],
  temperature: 0,
});

assert.equal(extractResponseText({
  choices: [{ message: { content: '[{"index":1}]' } }],
}, 'chat_completions'), '[{"index":1}]');

assert.equal(extractResponseText({ output_text: '[{"index":2}]' }, 'responses'), '[{"index":2}]');
assert.equal(extractResponseText({
  output: [{ content: [{ type: 'output_text', text: '[{"index":3}]' }] }],
}, 'responses'), '[{"index":3}]');

assert.equal(extractStreamText({
  choices: [{ delta: { content: 'chat chunk' } }],
}, 'chat_completions'), 'chat chunk');

assert.equal(extractStreamText({
  type: 'response.output_text.delta',
  delta: 'responses chunk',
}, 'responses'), 'responses chunk');

assert.equal(extractStreamError({
  type: 'response.failed',
  response: { error: { message: 'upstream failed' } },
}), 'upstream failed');

const originalFetch = globalThis.fetch;
const auditBodies = [];
let auditAttempt = 0;
globalThis.fetch = async (_url, init) => {
  auditBodies.push(JSON.parse(init.body));
  auditAttempt++;
  if (auditAttempt === 1) {
    return new Response(JSON.stringify({ error: { message: 'input_image is not supported' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ output_text: '{"summary":{}}' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
const degradedAudit = await requestAuditModel(responsesConfig, 'audit prompt', [auditImage]);
assert.deepEqual(degradedAudit, {
  text: '{"summary":{}}',
  usedVisuals: false,
  degradedReason: '当前模型线路不支持材料图像，已改用文本与元数据审核',
});
assert.equal(auditBodies.length, 2);
assert.equal(Array.isArray(auditBodies[0].input), true);
assert.equal(auditBodies[1].input, 'audit prompt');

globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify([
    {
      index: 20,
      fieldKey: '奖励情况[1].奖励名称',
      value: '模型擅自改写的名称',
      shortLabel: '获奖名称',
      confidence: 'high',
    },
    {
      index: 21,
      fieldKey: '家庭成员[1].姓名',
      value: '错误跨组值',
      shortLabel: '获奖级别',
      confidence: 'high',
    },
  ]) } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

const grounded = await matchFields([
  {
    index: 20,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '获奖名称',
    placeholder: '',
    ariaLabel: '',
    context: '',
    groupLabel: '奖励情况',
    columnLabel: '获奖名称',
    rowIndex: 0,
  },
  {
    index: 21,
    kind: 'text',
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '获奖级别',
    placeholder: '',
    ariaLabel: '',
    context: '',
    groupLabel: '奖励情况',
    columnLabel: '获奖级别',
    rowIndex: 0,
  },
], chatConfig, [
  { key: '奖励情况[1].奖励名称', value: '程序设计竞赛一等奖' },
  { key: '家庭成员[1].姓名', value: '测试家长' },
]);
assert.deepEqual(grounded.map(({ index, fieldKey, value }) => ({ index, fieldKey, value })), [{
  index: 20,
  fieldKey: '奖励情况[1].奖励名称',
  value: '程序设计竞赛一等奖',
}]);
assert.equal(isSemanticallyCompatibleMatch({ label: '固定电话', fillMode: 'short' }, '通讯地址'), false);
assert.equal(isSemanticallyCompatibleMatch({ label: '固定电话', fillMode: 'short' }, '手机号'), false);
assert.equal(isSemanticallyCompatibleMatch({ label: '通讯地址', fillMode: 'short' }, '手机号'), false);
assert.equal(isSemanticallyCompatibleMatch({ label: '考生电子邮箱', fillMode: 'short' }, '邮箱'), true);

const longBodies = [];
globalThis.fetch = async (_url, init) => {
  longBodies.push(JSON.parse(init.body));
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      text: '我参与了 PRISM-Net 项目，排名第一。',
      sourceRefs: [{ sectionId: '科研训练', itemIndex: 0, fieldKeys: ['项目名称', '排名'] }],
      missingFacts: [],
      needsReview: true,
    }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const longMatches = await matchFields([{
  index: 30,
  kind: 'text',
  tag: 'textarea',
  type: 'textarea',
  name: '',
  id: '',
  label: '请简述科研训练经历及个人贡献',
  placeholder: '',
  ariaLabel: '',
  context: '项目经历表单，500字以内',
  groupLabel: '项目经历',
  fillMode: 'long',
}], { ...chatConfig, fastMode: true }, [
  { key: '科研训练[1].项目名称', value: 'PRISM-Net' },
  { key: '科研训练[1].排名', value: '第一' },
]);
assert.equal(longMatches[0]?.fieldKey, 'generated_long_text');
assert.equal(longMatches[0]?.value, '我参与了 PRISM-Net 项目，排名第一。');
assert.equal(longBodies.length, 1);
assert.match(longBodies[0].messages[0].content, /fast\/快速模式/);
globalThis.fetch = originalFetch;

console.log('LLM API protocol tests passed');
