import { requestModelText } from '../matcher';
import type { ApiConfig } from '../storage';
import { parseAgentPagePlan } from './planner-response';
import {
  createAgentPlanningChunks,
  mergeAgentChunkPlans,
  type AgentPlanningInput,
} from './planner-chunks';
import { buildAgentPlannerPrompt } from './planner-prompt';
import type { AgentSourceRecord } from './profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from './types';

export interface RequestAgentPagePlanInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

export interface RequestAgentPagePlanOptions {
  requestText?: typeof requestModelText;
  onChunkProgress?(completed: number, total: number): void | Promise<void>;
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

async function requestSingleAgentPagePlan(
  input: AgentPlanningInput,
  apiConfig: ApiConfig,
  requestText: typeof requestModelText,
): Promise<AgentPagePlan> {
  const snapshotFingerprint = agentFingerprint(input.snapshot);
  const profileFingerprint = agentFingerprint(input.sourceRecords);
  const wireSnapshot: AgentPageSnapshot = {
    ...input.snapshot,
    pageKey: `page_${snapshotFingerprint}`,
  };
  const prompt = buildAgentPlannerPrompt({
    ...input,
    snapshot: wireSnapshot,
    snapshotFingerprint,
    profileFingerprint,
  }, { includeSchema: true });
  const text = await requestText(apiConfig, prompt, { stream: true });
  const parsed = validateFingerprints(parseAgentPagePlan(text, {
    snapshot: wireSnapshot,
    sourceRecords: input.sourceRecords,
    fileRecordIds: input.fileRecordIds,
  }), snapshotFingerprint, profileFingerprint);
  return { ...parsed, pageKey: input.snapshot.pageKey };
}

export async function requestAgentPagePlan(
  input: RequestAgentPagePlanInput,
  apiConfig: ApiConfig,
  options: RequestAgentPagePlanOptions = {},
): Promise<AgentPagePlan> {
  const snapshotFingerprint = agentFingerprint(input.snapshot);
  const profileFingerprint = agentFingerprint(input.sourceRecords);
  const chunks = createAgentPlanningChunks(input);
  if (chunks.length === 0) {
    return {
      version: 1,
      pageKey: input.snapshot.pageKey,
      snapshotFingerprint,
      profileFingerprint,
      actions: [],
      reviewItems: [],
    };
  }
  if (chunks.length === 1) {
    const plan = await requestSingleAgentPagePlan(chunks[0], apiConfig, options.requestText ?? requestModelText);
    await options.onChunkProgress?.(1, 1);
    return validateFingerprints({
      ...plan,
      snapshotFingerprint,
      profileFingerprint,
    }, snapshotFingerprint, profileFingerprint);
  }

  const plans: AgentPagePlan[] = [];
  for (const chunk of chunks) {
    plans.push(await requestSingleAgentPagePlan(chunk, apiConfig, options.requestText ?? requestModelText));
    await options.onChunkProgress?.(plans.length, chunks.length);
  }
  return validateFingerprints(
    mergeAgentChunkPlans(chunks, plans, snapshotFingerprint, profileFingerprint),
    snapshotFingerprint,
    profileFingerprint,
  );
}
