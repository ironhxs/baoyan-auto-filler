import type { AgentApplicationIdentity } from './types';

export interface InferAgentApplicationIdentityInput {
  title?: string;
  visibleTexts?: string[];
  profileInstitution?: string;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function extractInstitution(text: string): string {
  const labelled = text.match(/(?:报考学校|招生学校|招生单位|学校名称)[：:]?\s*([^，,。；;|｜·]{2,40}?(?:大学|学院))/u);
  if (labelled) return normalizeText(labelled[1]);
  return normalizeText(text.match(/[\p{Script=Han}A-Za-z0-9·（）()]{2,40}?(?:大学|学院)/u)?.[0]);
}

function isDepartmentName(text: string): boolean {
  return /(?:学院|系|研究院|学部|书院|招生单位|研究中心)$/u.test(text);
}

function isExplicitProjectName(text: string): boolean {
  return /(?:夏令营|冬令营|预推免|推免|优秀大学生|招生项目|报名项目|专项计划|选拔计划|申请项目)/u.test(text);
}

export function inferAgentApplicationIdentity(
  input: InferAgentApplicationIdentityInput,
): AgentApplicationIdentity {
  const title = normalizeText(input.title);
  const visibleTexts = unique(input.visibleTexts ?? []);
  const profileInstitution = normalizeText(input.profileInstitution);
  const titleInstitution = extractInstitution(title);

  const exactInstitutions = visibleTexts.filter((text) => /(?:大学|学院)$/u.test(text));
  const institutionCandidates = unique([
    titleInstitution,
    ...exactInstitutions,
    ...visibleTexts.map(extractInstitution),
  ]).filter((candidate) => (
    candidate !== profileInstitution
    || candidate === titleInstitution
  ));
  const institutionName = institutionCandidates.find((candidate) => candidate.endsWith('大学'))
    ?? institutionCandidates[0]
    ?? '';

  const departmentName = visibleTexts.find((text) => (
    text !== institutionName
    && text !== profileInstitution
    && isDepartmentName(text)
    && !isExplicitProjectName(text)
  )) ?? '';

  const projectName = visibleTexts.find((text) => (
    text !== institutionName
    && text !== departmentName
    && isExplicitProjectName(text)
  )) ?? (isExplicitProjectName(title) ? title : '');

  return { institutionName, departmentName, projectName };
}

export function formatAgentApplicationDisplayName(identity: AgentApplicationIdentity): string {
  return [identity.institutionName, identity.departmentName, identity.projectName]
    .map(normalizeText)
    .filter(Boolean)
    .join(' · ');
}
