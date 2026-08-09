import assert from 'node:assert/strict';

import { requestAgentModelThroughBridge } from '../utils/agent/model-bridge';
import type { ApiConfig } from '../utils/storage';

const config: ApiConfig = {
  baseUrl: 'https://relay.example/v1',
  apiKey: 'secret-test-key',
  model: 'gpt-5.6-sol',
  providerId: 'custom',
  apiMode: 'responses',
  fastMode: true,
  aiEnhanced: true,
};

{
  const calls: string[] = [];
  const text = await requestAgentModelThroughBridge(config, 'plan', { stream: true }, {
    supportsOffscreen: true,
    ensureOffscreen: async () => { calls.push('ensure'); },
    sendToOffscreen: async (message) => {
      calls.push(`send:${message.target}:${message.type}`);
      assert.equal(message.apiConfig.apiKey, 'secret-test-key');
      assert.equal(message.options.stream, true);
      return { ok: true, requestId: message.requestId, text: '{"version":1}' };
    },
    directRequest: async () => { throw new Error('direct path must not run'); },
  });
  assert.equal(text, '{"version":1}');
  assert.deepEqual(calls, ['ensure', 'send:baotian-offscreen:agentModelRequest']);
}

{
  let direct = 0;
  const text = await requestAgentModelThroughBridge(config, 'plan', { stream: true }, {
    supportsOffscreen: false,
    ensureOffscreen: async () => { throw new Error('unsupported'); },
    sendToOffscreen: async () => { throw new Error('unsupported'); },
    directRequest: async () => { direct += 1; return 'firefox-result'; },
  });
  assert.equal(text, 'firefox-result');
  assert.equal(direct, 1, 'Firefox/non-Chromium must keep the direct background path');
}

{
  await assert.rejects(
    () => requestAgentModelThroughBridge(config, 'plan', { stream: true }, {
      supportsOffscreen: true,
      ensureOffscreen: async () => undefined,
      sendToOffscreen: async (message) => ({
        ok: false,
        requestId: message.requestId,
        error: 'relay failed safely',
      }),
      directRequest: async () => 'must-not-fallback-after-relay-error',
    }),
    /relay failed safely/,
    'a relay error must not silently retry through another transport',
  );
}

console.log('agent model bridge tests passed');
