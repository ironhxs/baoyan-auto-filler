import type {
  AgentModelBridgeRequest,
  AgentModelBridgeResponse,
} from '@/utils/agent/model-bridge';

const worker = new Worker(new URL('./agent-worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<string, {
  resolve(response: AgentModelBridgeResponse): void;
  reject(error: Error): void;
}>();

worker.onmessage = (event: MessageEvent<AgentModelBridgeResponse>) => {
  const response = event.data;
  const request = pending.get(response.requestId);
  if (!request) return;
  pending.delete(response.requestId);
  request.resolve(response);
};

worker.onerror = () => {
  for (const request of pending.values()) request.reject(new Error('Agent model worker stopped unexpectedly'));
  pending.clear();
};

function runModelRequest(message: AgentModelBridgeRequest): Promise<AgentModelBridgeResponse> {
  return new Promise((resolve, reject) => {
    pending.set(message.requestId, { resolve, reject });
    worker.postMessage(message);
  });
}

chrome.runtime.onMessage.addListener((message: AgentModelBridgeRequest, _sender, sendResponse) => {
  if (message?.target !== 'baotian-offscreen' || message.type !== 'agentModelRequest') return false;
  const heartbeat = setInterval(() => {
    void chrome.runtime.sendMessage({
      target: 'baotian-background',
      type: 'agentModelHeartbeat',
      requestId: message.requestId,
    }).catch(() => undefined);
  }, 15_000);
  runModelRequest(message)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      requestId: message.requestId,
      error: error instanceof Error ? error.message : 'Agent model bridge failed',
    } satisfies AgentModelBridgeResponse))
    .finally(() => clearInterval(heartbeat));
  return true;
});
