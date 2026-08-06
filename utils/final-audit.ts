import type {
  ApplicationFieldSnapshot,
  ApplicationPageSnapshot,
  ApplicationTask,
  AuditFieldStatus,
} from './application-tasks';
import { fieldFingerprint } from './field-fingerprint';
import { isMeaningfullyFilled } from './local-matcher';
import type { FormFieldInfo, MatchResult } from './matcher';
import { isPageValueConsistent } from './value-compare';

export type FinalAuditSeverity = 'critical' | 'warning' | 'info';

export interface FinalAuditSummary {
  critical: number;
  warning: number;
  info: number;
}

export interface FinalAuditIssue {
  severity: FinalAuditSeverity;
  taskId?: string;
  pageId?: string;
  fieldFingerprint?: string;
  materialId?: string;
  title: string;
  evidence: string;
  expected?: string;
  actual?: string;
  recommendation: string;
}

export interface FinalAuditUnchecked {
  taskId?: string;
  pageId?: string;
  materialId?: string;
  title?: string;
  reason: string;
}

export interface FinalAuditConfirmed {
  taskId?: string;
  pageId?: string;
  materialId?: string;
  title: string;
}

export interface FinalAuditReport {
  summary: FinalAuditSummary;
  issues: FinalAuditIssue[];
  unchecked: FinalAuditUnchecked[];
  confirmed: FinalAuditConfirmed[];
}

export interface AuditPreflight {
  taskCount: number;
  pageCount: number;
  fieldCount: number;
  materialCount: number;
  sampledPageCount: number;
  notices: string[];
}

export interface BuildPageSnapshotInput {
  pageKey: string;
  pageLabel: string;
  pageUrl: string;
  pageSignature: string;
  capturedAt: number;
  fields: FormFieldInfo[];
  matches: MatchResult[];
}

const SENSITIVE_FIELD_PATTERN = /(?:password|passwd|pwd|captcha|验证码|校验码|csrf|xsrf|auth(?:orization)?|access[_-]?token|refresh[_-]?token|session|cookie|会话)/i;
const VOLATILE_FINGERPRINT_KEYS = new Set([
  'audit',
  'capturedAt',
  'createdAt',
  'lastOpenedAt',
  'message',
  'updatedAt',
]);

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizedLabel(field: FormFieldInfo): string {
  return field.columnLabel
    || field.label
    || field.ariaLabel
    || field.placeholder
    || field.title
    || field.name
    || field.id
    || `字段${field.index + 1}`;
}

export function isSensitiveAuditField(field: Partial<FormFieldInfo>): boolean {
  if (field.type === 'password' || field.type === 'hidden') return true;
  const clues = [
    field.name,
    field.id,
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.title,
  ].filter(Boolean).join(' ');
  return SENSITIVE_FIELD_PATTERN.test(clues);
}

export function samplePdfPages(pageCount: number, identityDocument: boolean): number[] {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];
  const count = Math.floor(pageCount);
  if (identityDocument || count <= 3) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  return [...new Set([1, Math.ceil(count / 2), count])];
}

function fieldStatus(field: FormFieldInfo, match: MatchResult | undefined): AuditFieldStatus {
  if (field.protected) return 'protected';
  const filled = isMeaningfullyFilled(field);
  if (!match) return filled ? 'review' : 'unmatched';
  if (match.kind === 'file' || field.kind === 'file') return 'review';
  if (!filled) return 'review';
  const allowSystemPrefix = field.selectionMode === 'dialog' || /出生地|籍贯|学校|院校|专业/.test(field.label ?? '');
  return isPageValueConsistent(field.value, match.value, allowSystemPrefix) ? 'verified' : 'mismatch';
}

function buildFieldSnapshot(field: FormFieldInfo, match?: MatchResult): ApplicationFieldSnapshot {
  return {
    index: field.index,
    fingerprint: fieldFingerprint(field),
    label: normalizedLabel(field),
    kind: field.kind ?? 'text',
    type: field.type,
    required: Boolean(field.required),
    currentValue: field.value ?? '',
    expectedValue: match?.value,
    fieldKey: match?.fieldKey,
    confidence: match?.confidence,
    source: match?.source,
    status: fieldStatus(field, match),
    protectionReason: field.protectionReason,
  };
}

export function buildPageSnapshot(input: BuildPageSnapshotInput): ApplicationPageSnapshot {
  const matchByIndex = new Map(input.matches.map((match) => [match.index, match]));
  const safeFields = input.fields.filter((field) => !isSensitiveAuditField(field));
  const fieldSnapshots = safeFields.map((field) => buildFieldSnapshot(field, matchByIndex.get(field.index)));
  const fieldByIndex = new Map(safeFields.map((field) => [field.index, field]));
  const materials = input.matches.flatMap((match) => {
    const field = fieldByIndex.get(match.index);
    if (!field || (match.kind !== 'file' && field.kind !== 'file')) return [];
    const fingerprint = fieldFingerprint(field);
    const filename = match.fileName || field.value || normalizedLabel(field);
    return [{
      id: `material-${stableHash(`${fingerprint}:${match.fileRecordId ?? filename}`)}`,
      fieldFingerprint: fingerprint,
      fieldLabel: normalizedLabel(field),
      source: match.fileRecordId != null ? 'local' as const : 'metadata' as const,
      fileRecordId: match.fileRecordId,
      filename,
      fileType: match.fileType,
      websiteDisplay: field.value,
      status: field.hasExistingFile || Boolean(field.value) ? 'existing' as const : 'selected' as const,
    }];
  });
  return {
    id: `page-${stableHash(input.pageKey)}`,
    key: input.pageKey,
    label: input.pageLabel || '未命名页面',
    url: input.pageUrl,
    signature: input.pageSignature,
    capturedAt: input.capturedAt,
    fields: fieldSnapshots,
    materials,
  };
}

export function buildAuditPreflight(tasks: ApplicationTask[], selectedTaskIds: string[]): AuditPreflight {
  const selected = new Set(selectedTaskIds);
  const included = tasks.filter((task) => selected.has(task.id) && task.status !== 'archived');
  const pages = included.flatMap((task) => task.pageOrder.map((pageId) => task.pages[pageId]).filter(Boolean));
  const materials = included.flatMap((task) => task.materials);
  const notices = materials.flatMap((material) => {
    if (material.status === 'missing') return [`${material.fieldLabel}：缺少材料`];
    if (material.status === 'unchecked') return [`${material.fieldLabel}：尚未核验内容`];
    return [];
  });
  return {
    taskCount: included.length,
    pageCount: pages.length,
    fieldCount: pages.reduce((total, page) => total + page.fields.length, 0),
    materialCount: materials.length,
    sampledPageCount: materials.reduce((total, material) => total + (material.selectedPages?.length ?? 0), 0),
    notices,
  };
}

function canonicalize(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, parentKey));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => !VOLATILE_FINGERPRINT_KEYS.has(key))
      .sort()
      .map((key) => [key, canonicalize(source[key], key)]),
  );
}

export function buildAuditFingerprint(input: unknown): string {
  const serialized = JSON.stringify(canonicalize(input));
  return `audit-v1-${serialized.length}-${stableHash(serialized)}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' && record[key] ? record[key] as string : undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key);
  if (!value) throw new Error('审核报告格式无效');
  return value;
}

export function parseFinalAuditReport(raw: string): FinalAuditReport {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('审核报告格式无效：模型未返回有效 JSON');
  }
  const record = asObject(parsed);
  const summary = asObject(record?.summary);
  if (!record || !summary || !Array.isArray(record.issues) || !Array.isArray(record.unchecked) || !Array.isArray(record.confirmed)) {
    throw new Error('审核报告格式无效');
  }
  const numberValue = (key: keyof FinalAuditSummary): number => {
    const value = summary[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const issues = record.issues.map((item): FinalAuditIssue => {
    const issue = asObject(item);
    if (!issue || !['critical', 'warning', 'info'].includes(String(issue.severity))) {
      throw new Error('审核报告格式无效');
    }
    return {
      severity: issue.severity as FinalAuditSeverity,
      taskId: optionalString(issue, 'taskId'),
      pageId: optionalString(issue, 'pageId'),
      fieldFingerprint: optionalString(issue, 'fieldFingerprint'),
      materialId: optionalString(issue, 'materialId'),
      title: requiredString(issue, 'title'),
      evidence: requiredString(issue, 'evidence'),
      expected: optionalString(issue, 'expected'),
      actual: optionalString(issue, 'actual'),
      recommendation: requiredString(issue, 'recommendation'),
    };
  });
  const unchecked = record.unchecked.map((item): FinalAuditUnchecked => {
    const entry = asObject(item);
    if (!entry) throw new Error('审核报告格式无效');
    return {
      taskId: optionalString(entry, 'taskId'),
      pageId: optionalString(entry, 'pageId'),
      materialId: optionalString(entry, 'materialId'),
      title: optionalString(entry, 'title'),
      reason: requiredString(entry, 'reason'),
    };
  });
  const confirmed = record.confirmed.map((item): FinalAuditConfirmed => {
    const entry = asObject(item);
    if (!entry) throw new Error('审核报告格式无效');
    return {
      taskId: optionalString(entry, 'taskId'),
      pageId: optionalString(entry, 'pageId'),
      materialId: optionalString(entry, 'materialId'),
      title: requiredString(entry, 'title'),
    };
  });
  return {
    summary: { critical: numberValue('critical'), warning: numberValue('warning'), info: numberValue('info') },
    issues,
    unchecked,
    confirmed,
  };
}

