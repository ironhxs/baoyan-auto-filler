import {
  deleteAgentPlanCacheRecord,
  getAgentPlanCacheRecord,
  saveAgentPlanCacheRecord,
} from '../db';
import type { AgentPlanCacheRecord } from '../db';
import type { ApiConfig } from '../storage';
import { agentFingerprint } from './planner';
import type { AgentSourceRecord } from './profile-retriever';
import type {
  AgentCheckpoint,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
} from './types';

export const AGENT_PROTOCOL_VERSION = 7;
export const AGENT_PLAN_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

export interface AgentPlanCacheIdentityInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  apiConfig: ApiConfig;
  protocolVersion?: number;
}

export function serializeAgentPlanCacheIdentity(input: AgentPlanCacheIdentityInput): string {
  return JSON.stringify({
    protocolVersion: input.protocolVersion ?? AGENT_PROTOCOL_VERSION,
    snapshot: input.snapshot,
    sourceRecords: input.sourceRecords,
    api: {
      baseUrl: input.apiConfig.baseUrl.replace(/\/+$/, ''),
      model: input.apiConfig.model,
      providerId: input.apiConfig.providerId,
      apiMode: input.apiConfig.apiMode,
      fastMode: input.apiConfig.fastMode,
      aiEnhanced: input.apiConfig.aiEnhanced,
    },
  });
}

export function createAgentPlanCacheKey(input: AgentPlanCacheIdentityInput): string {
  return `agent-plan:v${input.protocolVersion ?? AGENT_PROTOCOL_VERSION}:${agentFingerprint(
    JSON.parse(serializeAgentPlanCacheIdentity(input)),
  )}`;
}

export async function getAgentPlanCache(
  key: string,
  now = Date.now(),
): Promise<AgentPlanCacheRecord | null> {
  const record = await getAgentPlanCacheRecord(key);
  if (!record) return null;
  if (now - record.updatedAt <= AGENT_PLAN_CACHE_MAX_AGE_MS) return structuredClone(record);
  await deleteAgentPlanCacheRecord(key);
  return null;
}

export async function saveAgentPlanCache(
  key: string,
  pageKey: string,
  plan: AgentPagePlan,
  now = Date.now(),
): Promise<AgentPlanCacheRecord> {
  const existing = await getAgentPlanCacheRecord(key);
  const record: AgentPlanCacheRecord = {
    key,
    pageKey,
    plan: structuredClone(plan),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await saveAgentPlanCacheRecord(record);
  return structuredClone(record);
}

export function cloneAgentCheckpoint(checkpoint: AgentCheckpoint): AgentCheckpoint {
  return structuredClone(checkpoint);
}

function targetIdsForAction(action: AgentPlannedAction): string[] {
  if (action.type === 'fill_row') return action.values.map((value) => value.targetId);
  if (action.type === 'fill_field' || action.type === 'select' || action.type === 'upload') {
    return [action.targetId];
  }
  return [];
}

function actionCompleted(checkpoint: AgentCheckpoint, action: AgentPlannedAction): boolean {
  const results = checkpoint.results.filter((result) => result.actionId === action.actionId);
  const successful = (status: string) => status === 'verified' || status === 'manual';
  const targetIds = targetIdsForAction(action);
  if (targetIds.length === 0) return results.some((result) => successful(result.status));
  return targetIds.every((targetId) => results.some((result) => (
    result.targetId === targetId && successful(result.status)
  )));
}

export function nextPendingAgentActionIndex(checkpoint: AgentCheckpoint): number {
  if (!checkpoint.plan) return 0;
  const index = checkpoint.plan.actions.findIndex((action) => !actionCompleted(checkpoint, action));
  return index < 0 ? checkpoint.plan.actions.length : index;
}

export function updateAgentCheckpoint(
  checkpoint: AgentCheckpoint,
  patch: Partial<AgentCheckpoint>,
): AgentCheckpoint {
  const updated = structuredClone({ ...checkpoint, ...patch });
  updated.nextActionIndex = nextPendingAgentActionIndex(updated);
  return updated;
}
