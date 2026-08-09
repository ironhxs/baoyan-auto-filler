import { requestModelText } from '@/utils/matcher';
import type {
  AgentModelBridgeRequest,
  AgentModelBridgeResponse,
} from '@/utils/agent/model-bridge';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AgentModelBridgeRequest>) => void | Promise<void>) | null;
  postMessage(message: AgentModelBridgeResponse): void;
};

workerScope.onmessage = async (event: MessageEvent<AgentModelBridgeRequest>) => {
  const request = event.data;
  if (request?.type !== 'agentModelRequest') return;
  let response: AgentModelBridgeResponse;
  try {
    const text = await requestModelText(
      request.apiConfig,
      request.prompt,
      request.options,
    );
    response = { ok: true, requestId: request.requestId, text };
  } catch (error) {
    response = {
      ok: false,
      requestId: request.requestId,
      error: (error instanceof Error ? error.message : 'Agent model request failed')
        .replace(/\s+/g, ' ')
        .slice(0, 1200),
    };
  }
  workerScope.postMessage(response);
};
