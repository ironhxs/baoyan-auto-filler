export interface AgentPageDiscoveryCheckpoint {
  phase: 'collecting' | 'returning' | 'executing' | 'fallback';
  startPageKey: string;
  startUrl: string;
  visitedPageKeys: string[];
  returnAttempts?: number;
}

export interface AgentPageDiscoveryRecord {
  pageKey: string;
  url: string;
}

export type AgentPageDiscoveryDecision =
  | 'continue-collecting'
  | 'plan-and-return'
  | 'fallback-execution';

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function beginOrRecordAgentPageDiscovery(
  checkpoint: AgentPageDiscoveryCheckpoint | null | undefined,
  page: AgentPageDiscoveryRecord,
): { checkpoint: AgentPageDiscoveryCheckpoint; alreadyVisited: boolean } {
  const pageKey = normalized(page.pageKey);
  const url = normalized(page.url);
  if (!checkpoint) {
    return {
      checkpoint: {
        phase: 'collecting',
        startPageKey: pageKey,
        startUrl: url,
        visitedPageKeys: pageKey ? [pageKey] : [],
      },
      alreadyVisited: false,
    };
  }
  const alreadyVisited = checkpoint.visitedPageKeys.includes(pageKey);
  return {
    checkpoint: {
      ...checkpoint,
      visitedPageKeys: alreadyVisited || !pageKey
        ? [...checkpoint.visitedPageKeys]
        : [...checkpoint.visitedPageKeys, pageKey],
    },
    alreadyVisited,
  };
}

export function decideAgentPageDiscoveryNavigation(input: {
  clicked: boolean;
  advanced: boolean;
  alreadyVisited: boolean;
}): AgentPageDiscoveryDecision {
  if (input.alreadyVisited) return 'fallback-execution';
  if (!input.clicked) return 'plan-and-return';
  if (!input.advanced) return 'fallback-execution';
  return 'continue-collecting';
}

export function markAgentPageDiscoveryReturning(
  checkpoint: AgentPageDiscoveryCheckpoint,
): AgentPageDiscoveryCheckpoint {
  return { ...checkpoint, phase: 'returning', visitedPageKeys: [...checkpoint.visitedPageKeys] };
}

export function markAgentPageDiscoveryExecuting(
  checkpoint: AgentPageDiscoveryCheckpoint,
): AgentPageDiscoveryCheckpoint {
  return { ...checkpoint, phase: 'executing', visitedPageKeys: [...checkpoint.visitedPageKeys] };
}

export function markAgentPageDiscoveryFallback(
  checkpoint: AgentPageDiscoveryCheckpoint,
): AgentPageDiscoveryCheckpoint {
  return { ...checkpoint, phase: 'fallback', visitedPageKeys: [...checkpoint.visitedPageKeys] };
}
