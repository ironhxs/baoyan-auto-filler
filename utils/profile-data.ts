import type { BlockCategory } from './db';
import { getOptionalSectionFieldKeys, getSectionDefinition, getSectionFieldKeys } from './profile-schema';

export interface ProfileFieldData {
  key: string;
  value: string;
}

export interface ProfileBlockData {
  title: string;
  sectionId?: string;
  templateFields?: string[];
  items: Array<{ fields: ProfileFieldData[] }>;
}

export interface ProfileImportBundle {
  fields: ProfileFieldData[];
  blocks: ProfileBlockData[];
  warnings?: ProfileImportWarning[];
}

export interface ProfileImportWarning {
  kind: 'unknown-section' | 'unknown-field' | 'empty-record';
  sectionId?: string;
  fieldKey?: string;
  message: string;
}

export interface ProfileExportData extends ProfileImportBundle {
  schema: 'auto-filler.profile';
  version: 2;
  exportedAt: string;
}

export const PROFILE_EXPORT_SCHEMA = 'auto-filler.profile';
export const PROFILE_EXPORT_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeValue(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

const FIELD_ALIASES: Record<string, string> = {
  '奖项名称': '获奖名称',
  '奖项等级': '获奖等级',
  '获奖级别': '获奖等级',
  '奖项级别': '获奖等级',
  '获奖日期': '获奖时间',
  '论文名称': '论文标题',
  '刊物/会议': '刊物/会议名称',
  '论文发表时间': '发表时间',
  '项目时间段': '起止时间',
  '开始日期-结束日期': '起止时间',
  '项目描述': '主要工作内容',
  '本人职务': '本人角色',
  '获奖项目': '获奖项目名称',
  '比赛名称': '竞赛名称',
};

function canonicalFieldKey(key: string): string {
  return FIELD_ALIASES[key.trim()] ?? key.trim();
}

export function normalizeProfileFields(fields: Iterable<Partial<ProfileFieldData>>): ProfileFieldData[] {
  const seenKeys = new Set<string>();
  const normalized: ProfileFieldData[] = [];

  for (const field of fields) {
    const key = normalizeValue(field.key).trim();
    if (!key || seenKeys.has(key)) continue;

    normalized.push({
      key,
      value: normalizeValue(field.value).trim(),
    });
    seenKeys.add(key);
  }

  return normalized;
}

export function normalizeProfileBlocks(
  blocks: Iterable<Partial<ProfileBlockData>>,
  warnings: ProfileImportWarning[] = [],
): ProfileBlockData[] {
  const normalized: ProfileBlockData[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const title = normalizeValue(block.title).trim();
    if (!title) continue;
    const sectionId = normalizeValue(block.sectionId).trim() || undefined;
    const section = getSectionDefinition(sectionId);
    if (sectionId && !section) {
      warnings.push({ kind: 'unknown-section', sectionId, message: `未识别资料分组：${sectionId}` });
    }
    const identity = sectionId ? `section:${sectionId}` : `title:${title}`;
    if (seen.has(identity)) continue;

    const allowedFields = section
      ? new Set([...getSectionFieldKeys(section.id), ...getOptionalSectionFieldKeys(section.id)])
      : undefined;
    const templateFields = Array.from(new Set(
      (Array.isArray(block.templateFields) ? block.templateFields : [])
        .map((field) => canonicalFieldKey(normalizeValue(field)))
        .filter((field) => {
          if (!allowedFields || allowedFields.has(field)) return Boolean(field);
          warnings.push({ kind: 'unknown-field', sectionId, fieldKey: field, message: `未识别字段：${field}` });
          return false;
        })
        .filter(Boolean),
    ));
    const items = (Array.isArray(block.items) ? block.items : []).flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.fields)) return [];
      const fields = normalizeProfileFields(item.fields.filter(isRecord).map((field) => ({
        ...field,
        key: canonicalFieldKey(normalizeValue(field.key)),
      })).filter((field) => {
        const key = normalizeValue(field.key).trim();
        if (!allowedFields || allowedFields.has(key)) return Boolean(key);
        warnings.push({ kind: 'unknown-field', sectionId, fieldKey: key, message: `未识别字段：${key}` });
        return false;
      }));
      const meaningfulValues = fields.map((field) => field.value.trim()).filter(Boolean);
      if (sectionId && ['published_papers', 'granted_patents'].includes(sectionId) &&
        meaningfulValues.length > 0 && meaningfulValues.every((value) => value === '无')) {
        warnings.push({ kind: 'empty-record', sectionId, message: `${title}中的“无”记录已忽略` });
        return [];
      }
      return fields.length ? [{ fields }] : [];
    });

    normalized.push({
      title,
      ...(sectionId ? { sectionId } : {}),
      ...(templateFields.length ? { templateFields } : section
        ? { templateFields: [...getSectionFieldKeys(section.id), ...getOptionalSectionFieldKeys(section.id)] }
        : {}),
      items,
    });
    seen.add(identity);
  }

  return normalized;
}

export function createProfileExport(
  fields: Iterable<Partial<ProfileFieldData>>,
  exportedAt = new Date(),
  blocks: Iterable<Partial<ProfileBlockData>> = [],
): ProfileExportData {
  return {
    schema: PROFILE_EXPORT_SCHEMA,
    version: PROFILE_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    fields: normalizeProfileFields(fields),
    blocks: normalizeProfileBlocks(blocks),
  };
}

export function stringifyProfileExport(
  fields: Iterable<Partial<ProfileFieldData>>,
  exportedAt = new Date(),
  blocks: Iterable<Partial<ProfileBlockData>> = [],
): string {
  return `${JSON.stringify(createProfileExport(fields, exportedAt, blocks), null, 2)}\n`;
}

export function parseProfileImportBundle(rawJson: string): ProfileImportBundle {
  const warnings: ProfileImportWarning[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('JSON 文件格式不正确');
  }

  if (Array.isArray(parsed)) {
    return { fields: normalizeProfileFields(parsed.filter(isRecord)), blocks: [], warnings };
  }

  if (!isRecord(parsed)) {
    throw new Error('JSON 内容必须是对象或字段数组');
  }

  if ('schema' in parsed) {
    if (parsed.schema !== PROFILE_EXPORT_SCHEMA) throw new Error('不支持的 schema');
    const version = Number(parsed.version ?? 1);
    if (![1, PROFILE_EXPORT_VERSION].includes(version)) throw new Error('不支持的版本');
  }

  if ('fields' in parsed && !Array.isArray(parsed.fields)) throw new Error('fields 必须是字段数组');
  if ('blocks' in parsed && !Array.isArray(parsed.blocks)) throw new Error('blocks 必须是资料分组数组');

  if (Array.isArray(parsed.fields) || Array.isArray(parsed.blocks)) {
    return {
      fields: normalizeProfileFields((Array.isArray(parsed.fields) ? parsed.fields : []).filter(isRecord)),
      blocks: normalizeProfileBlocks((Array.isArray(parsed.blocks) ? parsed.blocks : []).filter(isRecord), warnings),
      warnings,
    };
  }

  return {
    fields: normalizeProfileFields(
      Object.entries(parsed)
        .filter(([key]) => !['schema', 'version', 'exportedAt', 'blocks'].includes(key))
        .map(([key, value]) => ({ key, value: normalizeValue(value) })),
    ),
    blocks: [],
    warnings,
  };
}

export function parseProfileImport(rawJson: string): ProfileFieldData[] {
  return parseProfileImportBundle(rawJson).fields;
}

export function mergeProfileFields(
  currentFields: Iterable<Partial<ProfileFieldData>>,
  importedFields: Iterable<Partial<ProfileFieldData>>,
): ProfileFieldData[] {
  const current = normalizeProfileFields(currentFields);
  const imported = normalizeProfileFields(importedFields);
  const importedByKey = new Map(imported.map((field) => [field.key, field.value]));
  const seenKeys = new Set<string>();

  const merged = current.map((field) => {
    seenKeys.add(field.key);
    if (!importedByKey.has(field.key)) return field;
    return { ...field, value: importedByKey.get(field.key) ?? '' };
  });

  for (const field of imported) {
    if (seenKeys.has(field.key)) continue;
    merged.push(field);
    seenKeys.add(field.key);
  }

  return merged;
}

export function appendProfileFields(
  currentFields: Iterable<Partial<ProfileFieldData>>,
  importedFields: Iterable<Partial<ProfileFieldData>>,
): ProfileFieldData[] {
  const appended = normalizeProfileFields(currentFields);
  const seenKeys = new Set(appended.map((field) => field.key));

  for (const field of normalizeProfileFields(importedFields)) {
    if (seenKeys.has(field.key)) continue;
    appended.push(field);
    seenKeys.add(field.key);
  }

  return appended;
}

export function mergeProfileBlocks(
  currentBlocks: BlockCategory[],
  importedBlocks: ProfileBlockData[],
): BlockCategory[] {
  const imported = normalizeProfileBlocks(importedBlocks);
  const identity = (block: Pick<ProfileBlockData, 'title' | 'sectionId'>) => (
    block.sectionId ? `section:${block.sectionId}` : `title:${block.title}`
  );
  const importedByIdentity = new Map(imported.map((block) => [identity(block), block]));
  const merged = currentBlocks.map((block) => {
    const replacement = importedByIdentity.get(identity(block));
    if (!replacement) return block;
    importedByIdentity.delete(identity(block));
    return { ...replacement, id: block.id } satisfies BlockCategory;
  });

  for (const block of importedByIdentity.values()) merged.push({ ...block });
  return merged;
}

export function appendProfileBlocks(
  currentBlocks: BlockCategory[],
  importedBlocks: ProfileBlockData[],
): BlockCategory[] {
  const identity = (block: Pick<ProfileBlockData, 'title' | 'sectionId'>) => {
    const sectionId = normalizeValue(block.sectionId).trim();
    const title = normalizeValue(block.title).trim();
    return sectionId ? `section:${sectionId}` : `title:${title}`;
  };
  const itemIdentity = (item: { fields: ProfileFieldData[] }) => JSON.stringify(
    normalizeProfileFields(item.fields)
      .sort((left, right) => left.key.localeCompare(right.key, 'zh-CN'))
      .map((field) => [field.key, field.value]),
  );

  const appended = currentBlocks.map((block) => ({
    ...block,
    items: block.items.map((item) => ({ fields: normalizeProfileFields(item.fields) })),
    ...(block.templateFields ? { templateFields: [...block.templateFields] } : {}),
  }));
  const currentByIdentity = new Map(appended.map((block) => [identity(block), block]));

  for (const importedBlock of normalizeProfileBlocks(importedBlocks)) {
    const existing = currentByIdentity.get(identity(importedBlock));
    if (!existing) {
      const newBlock: BlockCategory = {
        ...importedBlock,
        items: importedBlock.items.map((item) => ({ fields: [...item.fields] })),
      };
      appended.push(newBlock);
      currentByIdentity.set(identity(newBlock), newBlock);
      continue;
    }

    const templateFields = Array.from(new Set([
      ...(existing.templateFields ?? []),
      ...(importedBlock.templateFields ?? []),
    ]));
    if (templateFields.length) existing.templateFields = templateFields;

    const seenItems = new Set(existing.items.map(itemIdentity));
    for (const item of importedBlock.items) {
      const itemKey = itemIdentity(item);
      if (seenItems.has(itemKey)) continue;
      existing.items.push({ fields: [...item.fields] });
      seenItems.add(itemKey);
    }
  }

  return appended;
}
