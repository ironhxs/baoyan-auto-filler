import type { FormFieldInfo } from '../matcher';
import type {
  AgentFieldGroup,
  AgentPageSnapshot,
  AgentTargetField,
} from './types';

export interface BuildAgentPageSnapshotInput {
  pageKey: string;
  url: string;
  title: string;
  stepText?: string;
  instructions?: string[];
  fields: FormFieldInfo[];
  capturedAt?: number;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function normalizedColumnLabel(field: FormFieldInfo): string {
  return normalizeText(field.columnLabel || field.label || field.placeholder || field.name || field.id)
    .replace(/[：:＊*]+$/g, '') || `字段${field.index + 1}`;
}

function groupLabelFor(field: FormFieldInfo): string {
  return normalizeText(field.repeatGroup || field.groupLabel);
}

export function stableTargetId(pageKey: string, field: FormFieldInfo): string {
  const identity = [
    normalizeText(pageKey),
    groupLabelFor(field),
    field.rowIndex ?? '',
    normalizedColumnLabel(field),
    normalizeText(field.id),
    normalizeText(field.name),
    normalizeText(field.type),
    normalizeText(field.label),
    field.index,
  ].join('\u241f');
  return `target_${shortHash(identity)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function extractFormatHints(field: FormFieldInfo, instructions: string[]): string[] {
  const source = unique([
    field.dateFormat ?? '',
    field.hint ?? '',
    field.context ?? '',
    ...instructions,
  ]).join(' ');
  const hints = [field.dateFormat ?? ''];
  const examplePatterns = [
    /(?:日期|时间)?格式[^0-9]{0,8}(\d{4}[-/.年]\d{1,2})/g,
    /(?:示例|例如)[^0-9]{0,8}(\d{4}[-/.年]\d{1,2})/g,
  ];
  for (const pattern of examplePatterns) {
    for (const match of source.matchAll(pattern)) hints.push(match[1]);
  }
  return unique(hints);
}

function extractForbiddenCharacters(field: FormFieldInfo, instructions: string[]): string[] {
  const existing = field.forbiddenCharacters ?? [];
  const source = unique([field.hint ?? '', field.context ?? '', ...instructions]).join(' ');
  const extracted: string[] = [];
  const clauses = source.match(/(?:不得|不能|禁止)(?:含有|包含|输入|使用)?[^。；;\n]{0,40}/g) ?? [];
  for (const clause of clauses) {
    for (const character of clause.match(/[|#<>]/g) ?? []) extracted.push(character);
  }
  return unique([...existing, ...extracted]);
}

function toTargetField(
  pageKey: string,
  field: FormFieldInfo,
  instructions: string[],
  columnId?: string,
): AgentTargetField {
  return {
    targetId: stableTargetId(pageKey, field),
    index: field.index,
    rowIndex: field.rowIndex,
    columnId,
    label: normalizedColumnLabel(field),
    currentValue: field.value ?? '',
    required: Boolean(field.required),
    protected: Boolean(field.protected),
    kind: field.kind === 'file' ? 'file' : 'text',
    options: [...(field.options ?? [])],
    placeholder: field.placeholder ?? '',
    formatHints: extractFormatHints(field, instructions),
    forbiddenCharacters: extractForbiddenCharacters(field, instructions),
    maxLength: field.maxLength,
  };
}

function buildRepeatableGroup(
  pageKey: string,
  label: string,
  fields: FormFieldInfo[],
  instructions: string[],
): AgentFieldGroup {
  const labels = unique(fields.map(normalizedColumnLabel));
  const columns = labels.map((columnLabel) => ({
    columnId: `column_${shortHash(`${label}\u241f${columnLabel}`)}`,
    label: columnLabel,
  }));
  const columnByLabel = new Map(columns.map((column) => [column.label, column.columnId]));
  const rows = [...new Set(fields.map((field) => field.rowIndex ?? 0))]
    .sort((left, right) => left - right)
    .map((rowIndex) => ({
      rowIndex,
      fields: fields
        .filter((field) => (field.rowIndex ?? 0) === rowIndex)
        .map((field) => toTargetField(
          pageKey,
          field,
          instructions,
          columnByLabel.get(normalizedColumnLabel(field)),
        )),
    }));
  return {
    groupId: `group_${shortHash(`${pageKey}\u241f${label}`)}`,
    label,
    kind: 'repeatable',
    columns,
    fields: rows.flatMap((row) => row.fields),
    rows,
  };
}

export function buildAgentPageSnapshot(input: BuildAgentPageSnapshotInput): AgentPageSnapshot {
  const instructions = unique(input.instructions ?? []);
  const groupedFields = new Map<string, FormFieldInfo[]>();
  const singleFields: FormFieldInfo[] = [];
  const materialFields: FormFieldInfo[] = [];

  for (const field of input.fields) {
    if (field.kind === 'file') {
      materialFields.push(field);
      continue;
    }
    const repeatLabel = groupLabelFor(field);
    if (repeatLabel && field.rowIndex != null) {
      const groupFields = groupedFields.get(repeatLabel) ?? [];
      groupFields.push(field);
      groupedFields.set(repeatLabel, groupFields);
    } else {
      singleFields.push(field);
    }
  }

  const groups: AgentFieldGroup[] = [...groupedFields.entries()]
    .map(([label, fields]) => buildRepeatableGroup(input.pageKey, label, fields, instructions));

  if (singleFields.length > 0) {
    const label = normalizeText(input.title) || '普通字段';
    const fields = singleFields.map((field) => toTargetField(input.pageKey, field, instructions));
    groups.push({
      groupId: `group_${shortHash(`${input.pageKey}\u241fsingle`)}`,
      label,
      kind: 'single',
      columns: [],
      fields,
      rows: [],
    });
  }

  if (materialFields.length > 0) {
    const fields = materialFields.map((field) => toTargetField(input.pageKey, field, instructions));
    groups.push({
      groupId: `group_${shortHash(`${input.pageKey}\u241fmaterial`)}`,
      label: '材料上传',
      kind: 'material',
      columns: [],
      fields,
      rows: [],
    });
  }

  return {
    pageKey: input.pageKey,
    url: input.url,
    title: normalizeText(input.title) || '当前页面',
    stepText: normalizeText(input.stepText),
    instructions,
    groups,
    capturedAt: input.capturedAt ?? Date.now(),
  };
}

