import type { AgentCheckpoint, AgentPhase } from './types';

export interface AgentViewModel {
  phase: AgentPhase;
  phaseLabel: string;
  phaseTone: 'active' | 'success' | 'warning';
  planned: number;
  verified: number;
  manual: number;
  review: number;
  failed: number;
  skipped: number;
  pendingReview: number;
  cached: boolean;
  retries: number;
  error: string;
  canRetry: boolean;
  canAcceptManual: boolean;
  canReplan: boolean;
}

const phaseLabels: Record<AgentPhase, string> = {
  observing: '正在读取页面',
  planning: '正在生成计划',
  validating: '正在安全校验',
  preparing: '正在准备表格',
  executing: '正在填写',
  verifying: '正在回读检查',
  repairing: '正在修复失败项',
  paused: '等待确认',
  complete: '本页已核对',
};

export function sanitizeAgentDisplayText(input: string | undefined): string {
  if (!input) return '';
  let value = input.replace(/<[^>]*>/g, ' ');
  value = value.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{6,}\b/gi, '[已隐藏敏感信息]');
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}\b/gi, 'Bearer [已隐藏敏感信息]');
  value = value.replace(/\b(?:api[_ -]?key|password|passwd|pwd)\s*[:=]\s*[^\s;,，；]+/gi, '[已隐藏敏感信息]');
  value = value.replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[已隐藏敏感信息]');
  value = value.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[已隐藏敏感信息]');
  value = value.replace(/(?:raw\s+response|response\s+body|原始响应)\s*[:：][\s\S]*/gi, '模型服务详细响应已隐藏');
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function buildAgentViewModel(checkpoint: AgentCheckpoint | undefined): AgentViewModel | null {
  if (!checkpoint) return null;
  const count = (status: AgentCheckpoint['results'][number]['status']) => (
    checkpoint.results.filter((result) => result.status === status).length
  );
  const retries = Object.values(checkpoint.retries).reduce((sum, value) => sum + value, 0);
  const failed = count('failed');
  const manual = count('manual');
  const active = checkpoint.phase !== 'paused' && checkpoint.phase !== 'complete';
  return {
    phase: checkpoint.phase,
    phaseLabel: phaseLabels[checkpoint.phase],
    phaseTone: checkpoint.phase === 'complete' ? 'success' : checkpoint.phase === 'paused' ? 'warning' : 'active',
    planned: checkpoint.plan?.actions.length ?? 0,
    verified: count('verified'),
    manual,
    review: count('review'),
    failed,
    skipped: count('skipped'),
    pendingReview: checkpoint.plan?.reviewItems.length ?? 0,
    cached: checkpoint.cached === true,
    retries,
    error: sanitizeAgentDisplayText(checkpoint.error),
    canRetry: checkpoint.phase === 'paused' && failed > 0,
    canAcceptManual: checkpoint.phase === 'paused' && manual > 0,
    canReplan: !active,
  };
}
