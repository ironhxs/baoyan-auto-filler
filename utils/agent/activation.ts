import { isMeaningfullyFilled } from '../local-matcher';
import type { FormFieldInfo, MatchResult } from '../matcher';

export function shouldPreferPageAgent(
  fields: FormFieldInfo[],
  matches: MatchResult[],
  configured: boolean,
  enhanced: boolean,
): boolean {
  if (!configured || !enhanced) return false;
  const textFields = fields.filter((field) => field.kind !== 'file' && !field.protected);
  if (textFields.length === 0) return false;
  const repeatGroups = new Map<string, Set<string>>();
  for (const field of textFields) {
    const group = (field.repeatGroup || field.groupLabel || '').trim();
    if (!group || field.rowIndex == null) continue;
    const columns = repeatGroups.get(group) ?? new Set<string>();
    columns.add((field.columnLabel || field.label || `field-${field.index}`).trim());
    repeatGroups.set(group, columns);
  }
  if ([...repeatGroups.values()].some((columns) => columns.size >= 2)) return true;
  if (textFields.some((field) => field.fillMode === 'long')) return true;
  const covered = new Set(matches.filter((match) => match.kind !== 'file').map((match) => match.index));
  return textFields.filter((field) => !isMeaningfullyFilled(field) && !covered.has(field.index)).length >= 2;
}
