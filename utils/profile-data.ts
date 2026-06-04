export interface ProfileFieldData {
  key: string;
  value: string;
}

export interface ProfileExportData {
  schema: 'auto-filler.profile';
  version: 1;
  exportedAt: string;
  fields: ProfileFieldData[];
}

export const PROFILE_EXPORT_SCHEMA = 'auto-filler.profile';
export const PROFILE_EXPORT_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeValue(value: unknown): string {
  if (value == null) return '';
  return String(value);
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

export function createProfileExport(
  fields: Iterable<Partial<ProfileFieldData>>,
  exportedAt = new Date(),
): ProfileExportData {
  return {
    schema: PROFILE_EXPORT_SCHEMA,
    version: PROFILE_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    fields: normalizeProfileFields(fields),
  };
}

export function stringifyProfileExport(
  fields: Iterable<Partial<ProfileFieldData>>,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(createProfileExport(fields, exportedAt), null, 2)}\n`;
}

export function parseProfileImport(rawJson: string): ProfileFieldData[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('JSON 文件格式不正确');
  }

  if (Array.isArray(parsed)) {
    return normalizeProfileFields(parsed.filter(isRecord));
  }

  if (!isRecord(parsed)) {
    throw new Error('JSON 内容必须是对象或字段数组');
  }

  if ('schema' in parsed) {
    if (parsed.schema !== PROFILE_EXPORT_SCHEMA) {
      throw new Error('不支持的 schema');
    }
    if ('version' in parsed && parsed.version !== PROFILE_EXPORT_VERSION) {
      throw new Error('不支持的版本');
    }
  }

  if ('fields' in parsed && !Array.isArray(parsed.fields)) {
    throw new Error('fields 必须是字段数组');
  }

  if (Array.isArray(parsed.fields)) {
    return normalizeProfileFields(parsed.fields.filter(isRecord));
  }

  return normalizeProfileFields(
    Object.entries(parsed)
      .filter(([key]) => !['schema', 'version', 'exportedAt'].includes(key))
      .map(([key, value]) => ({ key, value: normalizeValue(value) })),
  );
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
