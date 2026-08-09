import { requestModelText } from '../matcher';
import type { ApiConfig } from '../storage';
import { parseAgentPagePlan } from './planner-response';
import {
  BAOTIAN_PAGE_PLAN_SCHEMA,
  buildAgentPlannerPrompt,
} from './planner-prompt';
import type { AgentSourceRecord } from './profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from './types';

export interface RequestAgentPagePlanInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'capturedAt' && key !== 'updatedAt')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function agentFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `fp_${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

export function isUnsupportedStructuredOutputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(message.match(/LLM API error\s+(\d+)/i)?.[1] ?? 0);
  if (![400, 404, 415, 422].includes(status)) return false;
  return /response_format|text\.format|json_schema|structured output|unsupported parameter|unknown parameter|not supported/i.test(message);
}

function validateFingerprints(
  plan: AgentPagePlan,
  snapshotFingerprint: string,
  profileFingerprint: string,
): AgentPagePlan {
  if (plan.snapshotFingerprint !== snapshotFingerprint) {
    throw new Error('Agent plan fingerprint does not match the current page snapshot');
  }
  if (plan.profileFingerprint !== profileFingerprint) {
    throw new Error('Agent plan fingerprint does not match the current profile records');
  }
  return plan;
}

export async function requestAgentPagePlan(
  input: RequestAgentPagePlanInput,
  apiConfig: ApiConfig,
): Promise<AgentPagePlan> {
  const snapshotFingerprint = agentFingerprint(input.snapshot);
  const profileFingerprint = agentFingerprint(input.sourceRecords);
  const prompt = buildAgentPlannerPrompt({
    ...input,
    snapshotFingerprint,
    profileFingerprint,
  });
  let text: string;
  try {
    text = await requestModelText(apiConfig, prompt, {
      stream: false,
      jsonSchema: BAOTIAN_PAGE_PLAN_SCHEMA,
    });
  } catch (error) {
    if (!isUnsupportedStructuredOutputError(error)) throw error;
    text = await requestModelText(
      apiConfig,
      `${prompt}\n\n当前中转不支持结构化输出参数。请仍严格按照上述 Schema 只返回一个 JSON 对象，不要使用 Markdown。`,
      { stream: false },
    );
  }
  return validateFingerprints(parseAgentPagePlan(text, {
    snapshot: input.snapshot,
    sourceRecords: input.sourceRecords,
    fileRecordIds: input.fileRecordIds,
  }), snapshotFingerprint, profileFingerprint);
}

