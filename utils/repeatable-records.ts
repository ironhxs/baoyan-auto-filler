import type { BlockCategory, BlockItem, TextField } from './db';
import type { FormFieldInfo } from './matcher';
import { getBlockSection, inferLanguageItems } from './profile-schema';

export interface RepeatableGroupPlan {
  groupLabel: string;
  itemCount: number;
  existingRowCount: number;
  rowBindings: Array<number | undefined>;
  missingItemIndexes: number[];
  rowsToAdd: number;
  unmatchedRowIndexes: number[];
}

export interface RepeatableRecordPlan {
  groups: Record<string, RepeatableGroupPlan>;
}

export interface RepeatRowTarget {
  groupLabel: string;
  requiredRows: number;
  missingItemIndexes: number[];
}

interface RepeatableSourceGroup {
  label: string;
  items: BlockItem[];
}

const IDENTITY_KEYS: Record<string, string[]> = {
  外语水平: ['考试名称', '外语考试', '外语水平', '外语等级', '考试类型'],
  家庭成员: ['姓名', '成员姓名', '家庭成员姓名'],
  学术成果: ['成果名称', '论文名称', '专利名称', '项目名称'],
  奖励情况: ['奖励名称', '获奖名称', '奖项名称', '竞赛名称', '比赛名称', '荣誉名称'],
  学习和工作经历: ['学校或单位', '学习或工作单位', '所在单位', '开始日期', '开始时间'],
};

function normalize(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/cet[-\s]?4/g, '英语四级')
    .replace(/cet[-\s]?6/g, '英语六级')
    .replace(/获奖|奖项|竞赛|比赛|荣誉/g, '奖励')
    .replace(/等级/g, '级别')
    .replace(/考试名称|外语考试|外语水平|外语等级|考试类型/g, '考试')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function sameText(left: string | undefined, right: string | undefined): boolean {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function sourceGroups(blocks: BlockCategory[], textFields: TextField[]): RepeatableSourceGroup[] {
  const groups = blocks.flatMap((block) => {
    const section = getBlockSection(block);
    if (!section || section.kind !== 'repeat') return [];
    return [{ label: section.title, items: block.items }];
  });
  if (!groups.some((group) => group.label === '外语水平')) {
    const inferred = inferLanguageItems(textFields);
    if (inferred.length > 0) groups.push({ label: '外语水平', items: inferred });
  }
  return groups.filter((group) => group.items.length > 0);
}

function rowFieldsForGroup(fields: FormFieldInfo[], groupLabel: string): Map<number, FormFieldInfo[]> {
  const rows = new Map<number, FormFieldInfo[]>();
  for (const field of fields) {
    if (field.rowIndex == null || !sameText(field.groupLabel, groupLabel)) continue;
    const row = rows.get(field.rowIndex) ?? [];
    row.push(field);
    rows.set(field.rowIndex, row);
  }
  return new Map([...rows.entries()].sort(([left], [right]) => left - right));
}

function identityValueFromRow(groupLabel: string, fields: FormFieldInfo[]): string {
  const keys = IDENTITY_KEYS[groupLabel] ?? [];
  const identityField = fields.find((field) => keys.some((key) => sameText(field.columnLabel || field.label, key)));
  return identityField?.value?.trim() ?? '';
}

function identityValueFromItem(groupLabel: string, item: BlockItem): string {
  const keys = IDENTITY_KEYS[groupLabel] ?? [];
  const identityField = item.fields.find((field) => keys.some((key) => sameText(field.key, key)));
  return identityField?.value.trim() ?? '';
}

function rowHasValue(fields: FormFieldInfo[]): boolean {
  return fields.some((field) => Boolean(field.value?.trim()));
}

function findMatchingItem(groupLabel: string, rowIdentity: string, items: BlockItem[], claimed: Set<number>): number | undefined {
  if (!rowIdentity) return undefined;
  const candidates = items
    .map((item, index) => ({ index, identity: identityValueFromItem(groupLabel, item) }))
    .filter((candidate) => !claimed.has(candidate.index) && sameText(candidate.identity, rowIdentity));
  return candidates.length === 1 ? candidates[0].index : undefined;
}

export function planRepeatableRecords(
  fields: FormFieldInfo[],
  blocks: BlockCategory[],
  textFields: TextField[],
): RepeatableRecordPlan {
  const groups: Record<string, RepeatableGroupPlan> = {};

  for (const source of sourceGroups(blocks, textFields)) {
    const pageRows = rowFieldsForGroup(fields, source.label);
    const rowBindings: Array<number | undefined> = [];
    const claimed = new Set<number>();
    const unmatchedRowIndexes: number[] = [];

    for (const [rowIndex, rowFields] of pageRows) {
      const rowIdentity = identityValueFromRow(source.label, rowFields);
      const matchingItem = findMatchingItem(source.label, rowIdentity, source.items, claimed);
      if (matchingItem != null) {
        claimed.add(matchingItem);
        rowBindings[rowIndex] = matchingItem;
      } else if (rowHasValue(rowFields)) {
        unmatchedRowIndexes.push(rowIndex);
      }
    }

    const remainingItemIndexes = source.items
      .map((_item, index) => index)
      .filter((index) => !claimed.has(index));
    const emptyRows = [...pageRows.entries()]
      .filter(([rowIndex, rowFields]) => rowBindings[rowIndex] == null && !rowHasValue(rowFields))
      .map(([rowIndex]) => rowIndex);
    for (const rowIndex of emptyRows) {
      const itemIndex = remainingItemIndexes.shift();
      if (itemIndex == null) break;
      rowBindings[rowIndex] = itemIndex;
      claimed.add(itemIndex);
    }

    const missingItemIndexes = source.items
      .map((_item, index) => index)
      .filter((index) => !claimed.has(index));
    groups[source.label] = {
      groupLabel: source.label,
      itemCount: source.items.length,
      existingRowCount: pageRows.size,
      rowBindings,
      missingItemIndexes,
      rowsToAdd: missingItemIndexes.length,
      unmatchedRowIndexes,
    };
  }

  return { groups };
}

export function getFieldItemBinding(field: FormFieldInfo, plan: RepeatableRecordPlan): number | undefined {
  if (field.rowIndex == null || !field.groupLabel) return undefined;
  const group = Object.values(plan.groups).find((candidate) => sameText(candidate.groupLabel, field.groupLabel));
  return group?.rowBindings[field.rowIndex];
}

export function buildRepeatRowTargets(plan: RepeatableRecordPlan): RepeatRowTarget[] {
  return Object.values(plan.groups)
    .filter((group) => group.rowsToAdd > 0)
    .map((group) => ({
      groupLabel: group.groupLabel,
      requiredRows: group.existingRowCount + group.rowsToAdd,
      missingItemIndexes: [...group.missingItemIndexes],
    }));
}
