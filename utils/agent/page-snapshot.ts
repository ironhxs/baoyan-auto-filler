import type { FormFieldInfo } from '../matcher';
import type {
  AgentMaterialContext,
  AgentQuestionContext,
  CompleteAgentFieldGroup,
  CompleteAgentPageSnapshot,
  CompleteAgentTargetField,
} from './types';
import { inferAgentApplicationIdentityFromPage } from './page-identity';
import type { RepeatableGroupObservation } from '../repeatable-records';

export interface BuildAgentPageSnapshotInput {
  pageKey: string;
  url: string;
  title: string;
  stepText?: string;
  instructions?: string[];
  visibleTexts?: string[];
  profileInstitution?: string;
  profileDepartment?: string;
  profileMajor?: string;
  fields: FormFieldInfo[];
  repeatGroups?: RepeatableGroupObservation[];
  capturedAt?: number;
}

const SENSITIVE_PAGE_DATA_PATTERN = /(?:password|passwd|pwd|captcha|验证码|校验码|短信码|动态码|csrf|xsrf|authorization|access[_-]?token|refresh[_-]?token|session|cookie|登录凭证|支付|缴费|付款|银行卡|卡号|cvv|原始(?:模型)?响应|raw\s+(?:model\s+)?response)/i;

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
  const stableParts = [
    groupLabelFor(field),
    field.rowIndex ?? '',
    normalizedColumnLabel(field),
    normalizeText(field.id),
    normalizeText(field.name),
    normalizeText(field.type),
    normalizeText(field.label),
  ];
  const identity = [
    normalizeText(pageKey),
    ...stableParts,
    ...(stableParts.some((part) => String(part).trim()) ? [] : [field.index]),
  ].join('\u241f');
  return `target_${shortHash(identity)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function isSensitiveField(field: FormFieldInfo): boolean {
  if (field.type === 'password' || field.type === 'hidden') return true;
  return SENSITIVE_PAGE_DATA_PATTERN.test(unique([
    field.name,
    field.id,
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.title ?? '',
    field.hint ?? '',
    field.context,
  ]).join(' '));
}

function safeSemanticTexts(values: string[]): string[] {
  return unique(values).filter((value) => !SENSITIVE_PAGE_DATA_PATTERN.test(value));
}

function sanitizePageUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      const values = parsed.searchParams.getAll(key);
      if (
        SENSITIVE_PAGE_DATA_PATTERN.test(key)
        || values.some((item) => SENSITIVE_PAGE_DATA_PATTERN.test(item))
      ) {
        parsed.searchParams.delete(key);
      }
    }
    if (SENSITIVE_PAGE_DATA_PATTERN.test(parsed.hash)) parsed.hash = '';
    return parsed.toString();
  } catch {
    return SENSITIVE_PAGE_DATA_PATTERN.test(value) ? '' : normalizeText(value);
  }
}

function sanitizeContextHtml(value: string | undefined): string {
  const withoutActiveContent = (value ?? '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|svg|iframe|canvas)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|svg|iframe|canvas)\b[^>]*\/?>/gi, '')
    .replace(/<input\b[^>]*\btype\s*=\s*(?:["']?(?:password|hidden)["']?)[^>]*>/gi, '')
    .replace(/<([a-z][\w:-]*)([^>]*)>/gi, (_match, tag: string, rawAttributes: string) => {
      const allowed = new Set([
        'accept',
        'aria-label',
        'disabled',
        'id',
        'maxlength',
        'multiple',
        'name',
        'placeholder',
        'readonly',
        'required',
        'role',
        'title',
        'type',
      ]);
      const kept: string[] = [];
      const attributePattern = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      for (const attribute of rawAttributes.matchAll(attributePattern)) {
        const name = attribute[1].toLowerCase();
        const attributeValue = attribute[2] ?? '';
        if (!allowed.has(name) || SENSITIVE_PAGE_DATA_PATTERN.test(attributeValue)) continue;
        kept.push(attribute[0].trim());
      }
      return `<${tag}${kept.length > 0 ? ` ${kept.join(' ')}` : ''}>`;
    })
    .trim();
  const semanticText = normalizeText(withoutActiveContent.replace(/<[^>]+>/g, ' '));
  return SENSITIVE_PAGE_DATA_PATTERN.test(semanticText) ? '' : withoutActiveContent;
}

function fieldQuestionText(field: FormFieldInfo): string {
  return safeSemanticTexts([
    field.repeatGroup ?? '',
    field.groupLabel ?? '',
    field.columnLabel ?? '',
    field.label,
    field.ariaLabel,
    field.title ?? '',
    field.placeholder,
    field.context,
  ]).join(' ');
}

function fieldAnnotations(field: FormFieldInfo): string[] {
  return safeSemanticTexts([
    field.hint ?? '',
    field.dateFormat ?? '',
    field.context,
  ]);
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
): CompleteAgentTargetField {
  return {
    targetId: stableTargetId(pageKey, field),
    index: field.index,
    rowIndex: field.rowIndex,
    columnId,
    label: normalizedColumnLabel(field),
    currentValue: SENSITIVE_PAGE_DATA_PATTERN.test(field.value ?? '') ? '' : (field.value ?? ''),
    required: Boolean(field.required),
    protected: Boolean(field.protected),
    kind: field.kind === 'file' ? 'file' : 'text',
    options: safeSemanticTexts(field.options ?? []),
    placeholder: field.placeholder ?? '',
    formatHints: extractFormatHints(field, instructions),
    forbiddenCharacters: extractForbiddenCharacters(field, instructions),
    maxLength: field.maxLength,
    questionText: fieldQuestionText(field),
    annotations: fieldAnnotations(field),
    contextHtml: sanitizeContextHtml(field.html),
    selectionMode: field.selectionMode,
  };
}

function buildQuestionContext(
  visiblePageText: string[],
  fields: FormFieldInfo[],
  instructions: string[],
): AgentQuestionContext {
  const annotations = safeSemanticTexts([
    ...instructions,
    ...fields.flatMap(fieldAnnotations),
  ]);
  const dateExamples = unique(fields.flatMap((field) => extractFormatHints(field, instructions)));
  const forbiddenCharacters = unique(fields.flatMap((field) => (
    extractForbiddenCharacters(field, instructions)
  )));
  const maxLengths = fields
    .map((field) => field.maxLength)
    .filter((value): value is number => Number.isFinite(value) && Number(value) > 0);
  const maxLength = maxLengths.length > 0 ? Math.min(...maxLengths) : undefined;
  return {
    fullText: visiblePageText.join('\n'),
    annotations,
    dateExamples,
    forbiddenCharacters,
    maxLength,
  };
}

function materialContext(pageKey: string, field: FormFieldInfo): AgentMaterialContext {
  const currentFilename = field.hasExistingFile
    ? normalizeText(field.value).split(/[\\/]/).pop() ?? ''
    : '';
  return {
    targetId: stableTargetId(pageKey, field),
    questionText: fieldQuestionText(field),
    existingFiles: safeSemanticTexts([currentFilename || (field.hasExistingFile ? '已存在文件' : '')]),
  };
}

function buildRepeatableGroup(
  pageKey: string,
  label: string,
  fields: FormFieldInfo[],
  instructions: string[],
): CompleteAgentFieldGroup {
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

export function buildAgentPageSnapshot(input: BuildAgentPageSnapshotInput): CompleteAgentPageSnapshot {
  const instructions = safeSemanticTexts(input.instructions ?? []);
  const safeFields = input.fields.filter((field) => !isSensitiveField(field));
  const groupedFields = new Map<string, FormFieldInfo[]>();
  const singleFields: FormFieldInfo[] = [];
  const materialFields: FormFieldInfo[] = [];

  for (const field of safeFields) {
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

  const groups: CompleteAgentFieldGroup[] = [...groupedFields.entries()]
    .map(([label, fields]) => buildRepeatableGroup(input.pageKey, label, fields, instructions));

  const observedLabels = new Set(groups.map((group) => normalizeText(group.label)));
  for (const observation of input.repeatGroups ?? []) {
    const label = normalizeText(observation.groupLabel);
    if (!label || observedLabels.has(label)) continue;
    const columns = unique([
      ...observation.tableHeaders,
      ...observation.fieldLabels,
    ]).map((columnLabel) => ({
      columnId: `column_${shortHash(`${label}\u241f${columnLabel}`)}`,
      label: columnLabel,
    }));
    groups.push({
      groupId: `group_${shortHash(`${input.pageKey}\u241f${label}`)}`,
      label,
      kind: 'repeatable',
      columns,
      fields: [],
      rows: [],
      observation: {
        presentation: observation.presentation,
        tableHeaders: unique(observation.tableHeaders),
        fieldLabels: unique(observation.fieldLabels),
        currentRowCount: observation.currentRowCount,
        hasAddControl: observation.hasAddControl,
        addControlLabel: normalizeText(observation.addControlLabel),
        dialogVisible: observation.dialogVisible,
      },
    });
    observedLabels.add(label);
  }

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

  const safeTitle = safeSemanticTexts([input.title])[0] ?? '当前页面';
  const safeStepText = safeSemanticTexts([input.stepText ?? ''])[0] ?? '';
  const visiblePageText = safeSemanticTexts([
    ...(input.visibleTexts ?? []),
    safeTitle,
    safeStepText,
    ...instructions,
    ...safeFields.flatMap((field) => [
      field.repeatGroup ?? '',
      field.groupLabel ?? '',
      field.columnLabel ?? '',
      field.label,
      field.hint ?? '',
      field.placeholder,
      field.context,
    ]),
  ]);
  const identity = inferAgentApplicationIdentityFromPage({
    title: safeTitle,
    url: input.url,
    pageLabel: safeStepText,
    visibleTexts: safeSemanticTexts(input.visibleTexts ?? []),
    fields: safeFields,
    profileInstitution: input.profileInstitution,
    profileDepartment: input.profileDepartment,
    profileMajor: input.profileMajor,
  });

  return {
    pageKey: input.pageKey,
    url: sanitizePageUrl(input.url),
    title: safeTitle,
    stepText: safeStepText,
    instructions,
    identity,
    questionContext: buildQuestionContext(visiblePageText, safeFields, instructions),
    visiblePageText,
    materials: materialFields.map((field) => materialContext(input.pageKey, field)),
    groups,
    capturedAt: input.capturedAt ?? Date.now(),
  };
}
