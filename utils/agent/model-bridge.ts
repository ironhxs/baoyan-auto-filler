import type { ModelRequestOptions } from '../matcher';
import type { ApiConfig } from '../storage';

export interface AgentModelBridgeRequest {
  target: 'baotian-offscreen';
  type: 'agentModelRequest';
  requestId: string;
  apiConfig: ApiConfig;
  prompt: string;
  options: ModelRequestOptions;
}

export type AgentModelBridgeResponse = {
  ok: true;
  requestId: string;
  text: string;
} | {
  ok: false;
  requestId: string;
  error: string;
};

export interface AgentModelBridgeDeps {
  supportsOffscreen: boolean;
  ensureOffscreen(): Promise<void>;
  sendToOffscreen(message: AgentModelBridgeRequest): Promise<unknown>;
  directRequest(
    apiConfig: ApiConfig,
    prompt: string,
    options: ModelRequestOptions,
  ): Promise<string>;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseBridgeResponse(raw: unknown, requestId: string): AgentModelBridgeResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Agent model bridge returned an invalid response');
  const response = raw as Record<string, unknown>;
  if (response.requestId !== requestId || typeof response.ok !== 'boolean') {
    throw new Error('Agent model bridge response does not match the current request');
  }
  if (response.ok) {
    if (typeof response.text !== 'string' || !response.text.trim()) {
      throw new Error('Agent model bridge returned empty model output');
    }
    return { ok: true, requestId, text: response.text };
  }
  return {
    ok: false,
    requestId,
    error: typeof response.error === 'string' && response.error.trim()
      ? response.error.trim()
      : 'Agent model bridge request failed',
  };
}

export async function requestAgentModelThroughBridge(
  apiConfig: ApiConfig,
  prompt: string,
  options: ModelRequestOptions,
  deps: AgentModelBridgeDeps,
): Promise<string> {
  if (!deps.supportsOffscreen) return deps.directRequest(apiConfig, prompt, options);
  await deps.ensureOffscreen();
  const requestId = createRequestId();
  const response = parseBridgeResponse(await deps.sendToOffscreen({
    target: 'baotian-offscreen',
    type: 'agentModelRequest',
    requestId,
    apiConfig,
    prompt,
    options,
  }), requestId);
  if (!response.ok) throw new Error(response.error);
  return response.text;
}
