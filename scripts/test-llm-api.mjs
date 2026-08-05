import assert from 'node:assert/strict';
import {
  extractResponseText,
  extractStreamError,
  extractStreamText,
  getRequestBody,
  getRequestUrl,
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

console.log('LLM API protocol tests passed');
