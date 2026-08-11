import { createAgentBatchBlueprint } from './batch-prompt';
import { findReusableAgentBatchPagePlan, mergeAgentBatchPages } from './batch-state';
import type { AgentBatchBlueprint, AgentBatchPageInput, AgentBatchPlan } from './batch-types';
import type { AgentPagePlan } from './types';

export interface AgentBatchPlanningInput {
  applicationId: string;
  pages: AgentBatchPageInput[];
  currentPageKey: string;
  existingBlueprint?: AgentBatchBlueprint;
  existingPlan?: AgentBatchPlan;
  capturedAt?: number;
}

export interface AgentBatchPlanningRequest {
  requestPlan(blueprint: AgentBatchBlueprint): Promise<AgentBatchPlan>;
}

export interface AgentBatchPlanningResult {
  phase: 'collecting' | 'executing';
  blueprint?: AgentBatchBlueprint;
  plan?: AgentBatchPlan;
  currentPagePlan: AgentPagePlan | null;
  planned: boolean;
}

export async function coordinateAgentBatchPlanning(
  input: AgentBatchPlanningInput,
  request: AgentBatchPlanningRequest,
): Promise<AgentBatchPlanningResult> {
  const pages = mergeAgentBatchPages(input.pages);
  if (pages.length < 2) {
    return { phase: 'collecting', currentPagePlan: null, planned: false };
  }

  const blueprint = createAgentBatchBlueprint(input.applicationId, pages, input.capturedAt);
  const currentPage = pages.find((page) => page.snapshot.pageKey === input.currentPageKey);
  if (!currentPage) return { phase: 'collecting', blueprint, currentPagePlan: null, planned: false };

  if (
    input.existingBlueprint?.fingerprint === blueprint.fingerprint
    && input.existingPlan?.blueprintFingerprint === blueprint.fingerprint
  ) {
    return {
      phase: 'executing',
      blueprint: structuredClone(input.existingBlueprint),
      plan: structuredClone(input.existingPlan),
      currentPagePlan: findReusableAgentBatchPagePlan(input.existingPlan, currentPage.snapshot, currentPage.sourceRecords),
      planned: false,
    };
  }

  const plan = await request.requestPlan(blueprint);
  if (plan.blueprintFingerprint !== blueprint.fingerprint) {
    throw new Error('Agent batch coordinator received a plan for a different blueprint');
  }
  return {
    phase: 'executing',
    blueprint,
    plan: structuredClone(plan),
    currentPagePlan: findReusableAgentBatchPagePlan(plan, currentPage.snapshot, currentPage.sourceRecords),
    planned: true,
  };
}
