import type { AgentApplicationIdentity } from './types';

export interface AgentApplicationIdentityContext {
  title: string;
  url: string;
  pageEvidenceTexts: string[];
  applicantIdentity: {
    institutionName: string;
    departmentName: string;
    majorName: string;
  };
}

interface AgentApplicationIdentityCandidate extends AgentApplicationIdentity {
  evidenceTexts: string[];
  confidence: string;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function emptyIdentity(): AgentApplicationIdentity {
  return { institutionName: '', departmentName: '', projectName: '' };
}

function safePageUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

export function needsAgentApplicationIdentity(identity: AgentApplicationIdentity): boolean {
  return !normalize(identity.institutionName) || !normalize(identity.departmentName);
}

export function mergeAgentApplicationIdentity(
  localIdentity: AgentApplicationIdentity,
  agentIdentity: AgentApplicationIdentity,
): AgentApplicationIdentity {
  return {
    institutionName: normalize(localIdentity.institutionName) || normalize(agentIdentity.institutionName),
    departmentName: normalize(localIdentity.departmentName) || normalize(agentIdentity.departmentName),
    projectName: normalize(localIdentity.projectName) || normalize(agentIdentity.projectName),
  };
}

export function buildAgentApplicationIdentityPrompt(context: AgentApplicationIdentityContext): string {
  return [
    '你是“保填 Agent”的报名任务身份识别器。只判断当前报名的目标学校、目标院系和项目名称。',
    '页面证据与申请人来源身份必须严格分开。申请人的本科院校、本科院系和本科专业绝不能直接当作目标报名身份。',
    '只能引用 pageEvidenceTexts 中真实存在的文本作为 evidenceTexts。证据不足时，对应名称必须返回空字符串，不能猜测。',
    'confidence 只能返回 high、medium 或 low；只有页面证据明确时使用 high。只返回 JSON，不要解释。',
    'JSON 结构：{"institutionName":"","departmentName":"","projectName":"","evidenceTexts":[],"confidence":"high"}',
    `页面标题：${normalize(context.title)}`,
    `页面 URL：${safePageUrl(context.url)}`,
    `页面证据：${JSON.stringify(context.pageEvidenceTexts.map(normalize).filter(Boolean))}`,
    `申请人来源身份：${JSON.stringify(context.applicantIdentity)}`,
  ].join('\n\n');
}

function parseCandidate(text: string): AgentApplicationIdentityCandidate | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return {
      institutionName: normalize(value.institutionName),
      departmentName: normalize(value.departmentName),
      projectName: normalize(value.projectName),
      evidenceTexts: Array.isArray(value.evidenceTexts) ? value.evidenceTexts.map(normalize).filter(Boolean) : [],
      confidence: normalize(value.confidence),
    };
  } catch {
    return null;
  }
}

export function parseAndValidateAgentApplicationIdentity(
  text: string,
  context: AgentApplicationIdentityContext,
): AgentApplicationIdentity {
  const candidate = parseCandidate(text);
  if (!candidate || candidate.confidence !== 'high') return emptyIdentity();
  const evidenceWhitelist = new Set(context.pageEvidenceTexts.map(normalize).filter(Boolean));
  if (candidate.evidenceTexts.length === 0
    || candidate.evidenceTexts.some((evidence) => !evidenceWhitelist.has(evidence))) {
    return emptyIdentity();
  }
  const sourceValues = new Set([
    context.applicantIdentity.institutionName,
    context.applicantIdentity.departmentName,
    context.applicantIdentity.majorName,
  ].map(normalize).filter(Boolean));
  const supported = (value: string): boolean => (
    Boolean(value) && candidate.evidenceTexts.some((evidence) => evidence.includes(value))
  );
  const institutionName = sourceValues.has(candidate.institutionName) || !supported(candidate.institutionName)
    ? ''
    : candidate.institutionName;
  const departmentName = sourceValues.has(candidate.departmentName) || !supported(candidate.departmentName)
    ? ''
    : candidate.departmentName;
  const projectName = sourceValues.has(candidate.projectName) || !supported(candidate.projectName)
    ? ''
    : candidate.projectName;
  return { institutionName, departmentName, projectName };
}
