import { agentFingerprint } from './planner';
import { parseAgentPagePlan } from './planner-response';
import type { AgentBatchBlueprint, AgentBatchPlan } from './batch-types';

export class AgentBatchPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBatchPlanValidationError';
  }
}

function fail(message: string): never {
  throw new AgentBatchPlanValidationError(message);
}

function stripCodeFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function parseAgentBatchPlan(text: string, blueprint: AgentBatchBlueprint): AgentBatchPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(text));
  } catch (error) {
    fail(`Agent batch plan is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  const plan = object(raw, 'batch plan');
  const keys = Object.keys(plan).sort();
  const expectedKeys = ['blueprintFingerprint', 'pagePlans', 'reviewItems', 'version'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) fail('batch plan has unexpected or missing keys');
  if (plan.version !== 1) fail('batch plan version must equal 1');
  if (plan.blueprintFingerprint !== blueprint.fingerprint) fail('batch plan fingerprint does not match the current blueprint');
  if (!Array.isArray(plan.pagePlans)) fail('batch plan pagePlans must be an array');
  if (!Array.isArray(plan.reviewItems) || plan.reviewItems.some((item) => typeof item !== 'string')) {
    fail('batch plan reviewItems must be a string array');
  }

  const inputsByPageKey = new Map(blueprint.pages.map((page) => [page.snapshot.pageKey, page]));
  const parsedByPageKey = new Map<string, ReturnType<typeof parseAgentPagePlan>>();
  for (const [index, rawPagePlan] of plan.pagePlans.entries()) {
    const pageObject = object(rawPagePlan, `batch plan pagePlans[${index}]`);
    const pageKey = typeof pageObject.pageKey === 'string' ? pageObject.pageKey : '';
    if (!pageKey || !inputsByPageKey.has(pageKey)) fail(`batch plan contains unknown pageKey: ${pageKey || '(empty)'}`);
    if (parsedByPageKey.has(pageKey)) fail(`batch plan contains duplicate pageKey: ${pageKey}`);
    const input = inputsByPageKey.get(pageKey)!;
    let parsed;
    try {
      parsed = parseAgentPagePlan(JSON.stringify(pageObject), {
        snapshot: input.snapshot,
        sourceRecords: input.sourceRecords,
        fileRecordIds: input.fileRecordIds,
      });
    } catch (error) {
      fail(`batch plan page ${pageKey} failed validation: ${error instanceof Error ? error.message : 'invalid page plan'}`);
    }
    if (parsed.snapshotFingerprint !== agentFingerprint(input.snapshot)) {
      fail(`batch plan page ${pageKey} snapshot fingerprint mismatch`);
    }
    if (parsed.profileFingerprint !== agentFingerprint(input.sourceRecords)) {
      fail(`batch plan page ${pageKey} profile fingerprint mismatch`);
    }
    parsedByPageKey.set(pageKey, parsed);
  }

  const missing = blueprint.pages
    .map((page) => page.snapshot.pageKey)
    .filter((pageKey) => !parsedByPageKey.has(pageKey));
  if (missing.length > 0) fail(`batch plan missing pageKey: ${missing.join(', ')}`);
  return {
    version: 1,
    blueprintFingerprint: blueprint.fingerprint,
    pagePlans: blueprint.pages.map((page) => parsedByPageKey.get(page.snapshot.pageKey)!),
    reviewItems: [...plan.reviewItems] as string[],
  };
}
