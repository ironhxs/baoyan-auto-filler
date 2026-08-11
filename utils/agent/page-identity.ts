import type { AgentApplicationIdentity } from './types';

export interface InferAgentApplicationIdentityInput {
  title?: string;
  url?: string;
  visibleTexts?: string[];
  profileInstitution?: string;
  profileDepartment?: string;
  profileMajor?: string;
}

export interface AgentIdentityFieldLike {
  label?: string;
  groupLabel?: string;
  value?: string;
  context?: string;
}

export interface InferAgentApplicationIdentityFromPageInput {
  title?: string;
  url?: string;
  pageLabel?: string;
  visibleTexts?: string[];
  fields: AgentIdentityFieldLike[];
  profileInstitution?: string;
  profileDepartment?: string;
  profileMajor?: string;
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

function projectNameFromTitle(text: string): string {
  const normalized = normalizeText(text);
  return normalizeText(normalized.match(/(?:预推免|推免|夏令营|冬令营|优秀大学生(?:夏令营)?|专项计划|选拔计划|招生项目|报名项目|申请项目)/u)?.[0]);
}

const OFFICIAL_INSTITUTION_DOMAINS: Array<[suffix: string, name: string]> = [
  ['sysu.edu.cn', '中山大学'],
  ['fudan.edu.cn', '复旦大学'],
  ['seu.edu.cn', '东南大学'],
];

function institutionFromUrl(value: string | undefined): string {
  try {
    const hostname = new URL(value ?? '').hostname.toLowerCase();
    return OFFICIAL_INSTITUTION_DOMAINS.find(([suffix]) => (
      hostname === suffix || hostname.endsWith(`.${suffix}`)
    ))?.[1] ?? '';
  } catch {
    return '';
  }
}

function normalizeDepartmentName(value: string): string {
  return normalizeText(value).replace(/^\d{2,12}\s*/u, '');
}

function isTargetIdentityField(field: AgentIdentityFieldLike): boolean {
  const label = normalizeText(`${field.groupLabel ?? ''} ${field.label ?? ''} ${field.context ?? ''}`);
  if (/本科|毕业|原学校|原院系|所在院系/u.test(label)) return false;
  return /申请院系|报考院系|招生院系|目标院系|申请院系所|报考院系所|招生单位|报考单位|申请项目|报名项目/u.test(label);
}

export function collectAgentApplicationPageEvidence(
  input: InferAgentApplicationIdentityFromPageInput,
): string[] {
  const sourceValues = new Set([
    input.profileInstitution,
    input.profileDepartment,
    input.profileMajor,
  ].map(normalizeText).filter(Boolean));
  return unique([
    input.title ?? '',
    input.pageLabel ?? '',
    ...(input.visibleTexts ?? []),
    ...input.fields.flatMap((field) => (
      isTargetIdentityField(field) && field.value && field.value.length <= 80 ? [field.value] : []
    )),
  ]).filter((value) => (
    !sourceValues.has(value)
    && ![...sourceValues].some((sourceValue) => value.includes(sourceValue))
    && !/(?:本科|毕业|原学校|原院系|所在院系)/u.test(value)
  ));
}

export function inferAgentApplicationIdentity(
  input: InferAgentApplicationIdentityInput,
): AgentApplicationIdentity {
  const title = normalizeText(input.title);
  const visibleTexts = unique(input.visibleTexts ?? []);
  const profileInstitution = normalizeText(input.profileInstitution);
  const sourceIdentityValues = new Set([
    profileInstitution,
    normalizeText(input.profileDepartment),
    normalizeText(input.profileMajor),
  ].filter(Boolean));
  const titleInstitution = extractInstitution(title);
  const urlInstitution = institutionFromUrl(input.url);

  const exactInstitutions = visibleTexts.filter((text) => (
    /(?:大学|学院)$/u.test(text) && !sourceIdentityValues.has(text)
  ));
  const institutionCandidates = unique([
    urlInstitution,
    titleInstitution,
    ...exactInstitutions,
    ...visibleTexts.map(extractInstitution),
  ]).filter((candidate) => (
    !sourceIdentityValues.has(candidate)
    || candidate === titleInstitution
  ));
  const institutionName = institutionCandidates.find((candidate) => candidate.endsWith('大学'))
    ?? institutionCandidates[0]
    ?? '';

  const departmentName = visibleTexts
    .map(normalizeDepartmentName)
    .find((text) => (
      text !== institutionName
      && !sourceIdentityValues.has(text)
      && isDepartmentName(text)
      && !isExplicitProjectName(text)
    )) ?? '';

  const projectName = visibleTexts.find((text) => (
    text !== institutionName
    && text !== departmentName
    && isExplicitProjectName(text)
  )) ?? projectNameFromTitle(title);

  return { institutionName, departmentName, projectName };
}

export function inferAgentApplicationIdentityFromPage(
  input: InferAgentApplicationIdentityFromPageInput,
): AgentApplicationIdentity {
  const title = normalizeText(input.title);
  const visibleTexts = collectAgentApplicationPageEvidence(input).filter((value) => value !== title);
  return inferAgentApplicationIdentity({
    title: input.title,
    url: input.url,
    visibleTexts,
    profileInstitution: input.profileInstitution,
    profileDepartment: input.profileDepartment,
    profileMajor: input.profileMajor,
  });
}

export function formatAgentApplicationDisplayName(identity: AgentApplicationIdentity): string {
  return [identity.institutionName, identity.departmentName, identity.projectName]
    .map(normalizeText)
    .filter(Boolean)
    .join(' · ');
}
