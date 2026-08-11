import { createAgentBatchBlueprint, sanitizeAgentSourceRecords } from './batch-prompt';
import { agentFingerprint } from './planner';
import type {
  AgentBatchBlueprint,
  AgentBatchPageInput,
  AgentBatchPlan,
} from './batch-types';
import type { AgentSourceRecord } from './profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from './types';

export function mergeAgentBatchPages(pages: AgentBatchPageInput[]): AgentBatchPageInput[] {
  const merged: AgentBatchPageInput[] = [];
  const indexByPageKey = new Map<string, number>();
  for (const page of pages) {
    const pageKey = page.snapshot.pageKey;
    const existingIndex = indexByPageKey.get(pageKey);
    if (existingIndex == null) {
      indexByPageKey.set(pageKey, merged.length);
      merged.push(structuredClone(page));
      continue;
    }
    if (page.snapshot.capturedAt >= merged[existingIndex].snapshot.capturedAt) {
      merged[existingIndex] = structuredClone(page);
    }
  }
  return merged;
}

export function findReusableAgentBatchPagePlan(
  plan: AgentBatchPlan | null | undefined,
  snapshot: AgentPageSnapshot,
  sourceRecords: AgentSourceRecord[],
): AgentPagePlan | null {
  const pagePlan = plan?.pagePlans.find((candidate) => candidate.pageKey === snapshot.pageKey);
  if (!pagePlan) return null;
  if (pagePlan.snapshotFingerprint !== agentFingerprint(snapshot)) return null;
  if (pagePlan.profileFingerprint !== agentFingerprint(sanitizeAgentSourceRecords(sourceRecords))) return null;
  return structuredClone(pagePlan);
}

export function refreshAgentBatchPage(
  blueprint: AgentBatchBlueprint,
  plan: AgentBatchPlan,
  page: AgentBatchPageInput,
  pagePlan: AgentPagePlan,
  capturedAt = Date.now(),
): { blueprint: AgentBatchBlueprint; plan: AgentBatchPlan } {
  const pages = mergeAgentBatchPages([...blueprint.pages, page]);
  const nextBlueprint = createAgentBatchBlueprint(blueprint.applicationId, pages, capturedAt);
  const normalizedPage = nextBlueprint.pages.find((candidate) => candidate.snapshot.pageKey === page.snapshot.pageKey);
  if (!normalizedPage || pagePlan.pageKey !== normalizedPage.snapshot.pageKey) {
    throw new Error('Agent batch page refresh does not match the target page');
  }
  if (pagePlan.snapshotFingerprint !== agentFingerprint(normalizedPage.snapshot)) {
    throw new Error('Agent batch page refresh snapshot fingerprint mismatch');
  }
  if (pagePlan.profileFingerprint !== agentFingerprint(normalizedPage.sourceRecords)) {
    throw new Error('Agent batch page refresh profile fingerprint mismatch');
  }
  const pagePlans = plan.pagePlans.map((candidate) => (
    candidate.pageKey === pagePlan.pageKey ? structuredClone(pagePlan) : structuredClone(candidate)
  ));
  if (!pagePlans.some((candidate) => candidate.pageKey === pagePlan.pageKey)) {
    pagePlans.push(structuredClone(pagePlan));
  }
  return {
    blueprint: nextBlueprint,
    plan: {
      version: 1,
      blueprintFingerprint: nextBlueprint.fingerprint,
      pagePlans,
      reviewItems: [...plan.reviewItems],
    },
  };
}
