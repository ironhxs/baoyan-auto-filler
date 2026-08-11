import type { ApplicationRunnerCheckpoint } from '../page-analysis';

export interface AgentBatchProgressView {
  label: string;
  pageCount: number;
  tone: 'neutral' | 'active' | 'warning';
}

export function buildAgentBatchProgressView(
  checkpoint: ApplicationRunnerCheckpoint | undefined,
): AgentBatchProgressView | null {
  const phase = checkpoint?.batchPhase;
  if (!phase) return null;
  const pageCount = checkpoint.batchBlueprint?.pages.length ?? 0;
  if (phase === 'collecting') return { label: '跨页收集中', pageCount, tone: 'neutral' };
  if (phase === 'planning') return { label: '正在综合规划', pageCount, tone: 'active' };
  if (phase === 'executing') return { label: '跨页计划已启用', pageCount, tone: 'active' };
  return { label: '跨页规划需确认', pageCount, tone: 'warning' };
}
