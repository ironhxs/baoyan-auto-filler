import type { BlockCategory, BlockItem, TextField } from './db';
import type { FormFieldInfo } from './matcher';
import type { AgentSourceRecord } from './agent/profile-retriever';
import { getBlockSection, inferLanguageItems } from './profile-schema';
import {
  getProfileProjectionSourceSectionId,
  projectProfileToTargetSchema,
  type ProfileProjectionCandidate,
  type TargetFieldSchema,
} from './profile-projections';

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

export interface RepeatDialogRecordTarget {
  itemIndex: number;
  fields: Array<{ key: string; value: string }>;
  sourceRecord: AgentSourceRecord;
}

export interface RepeatDialogTarget {
  groupLabel: string;
  records: RepeatDialogRecordTarget[];
}

export interface PrepareRepeatRowsResult {
  added: number;
  failures: Array<{ groupLabel: string; reason: string }>;
  dialogGroups?: string[];
}

export interface PrepareRepeatRecordsResult {
  added: number;
  processed: number;
  blocked?: boolean;
  dismissedGroups?: string[];
  failures: Array<{
    groupLabel: string;
    itemIndex?: number;
    presentation: 'inline' | 'dialog';
    reason: string;
  }>;
}

export interface RepeatableGroupObservation {
  groupLabel: string;
  presentation: 'inline' | 'dialog' | 'unknown';
  tableHeaders: string[];
  fieldLabels: string[];
  currentRowCount: number;
  hasAddControl: boolean;
  addControlLabel?: string;
  dialogVisible: boolean;
}

export interface CommitRepeatRecordResult {
  groupLabel: string;
  committed: boolean;
  reason: string;
}

export interface RepeatableRowScanResult<T> {
  scanResults: T[];
  preparation: PrepareRepeatRowsResult;
}

export const MAX_REPEAT_ROW_ADDITIONS_PER_PASS = 24;
export const MAX_REPEAT_DIALOG_PASSES_PER_SCAN = 12;

export function planRepeatRowPreparation(
  requiredRows: number,
  currentRows: number,
): { targetRows: number; truncated: boolean } {
  const requested = Math.max(Math.floor(requiredRows), 0);
  const current = Math.max(Math.floor(currentRows), 0);
  const targetRows = Math.max(
    current,
    Math.min(requested, current + MAX_REPEAT_ROW_ADDITIONS_PER_PASS),
  );
  return { targetRows, truncated: requested > targetRows };
}

export function limitRepeatRecordBatch<T>(
  records: T[],
): { records: T[]; truncated: boolean } {
  const limitedRecords = records.slice(0, MAX_REPEAT_ROW_ADDITIONS_PER_PASS);
  return { records: limitedRecords, truncated: records.length > limitedRecords.length };
}

export async function forEachRepeatPreparationTarget<T>(
  targets: T[],
  visit: (target: T) => Promise<'continue' | 'stop'>,
): Promise<void> {
  for (const target of targets) {
    if (await visit(target) === 'stop') return;
  }
}

export async function runSequentialRepeatPreparationPasses<T extends {
  dialogGroups: string[];
  stop?: boolean;
}>(
  runPass: (passIndex: number) => Promise<T>,
  maxPasses = MAX_REPEAT_DIALOG_PASSES_PER_SCAN,
): Promise<{ passes: T[]; truncated: boolean }> {
  const passes: T[] = [];
  const limit = Math.max(Math.floor(maxPasses), 1);
  for (let passIndex = 0; passIndex < limit; passIndex++) {
    const pass = await runPass(passIndex);
    passes.push(pass);
    if (pass.stop || pass.dialogGroups.length === 0) {
      return { passes, truncated: false };
    }
  }
  return { passes, truncated: true };
}

interface RepeatableSourceGroup {
  label: string;
  sectionId?: string;
  items: BlockItem[];
  origins: Array<{
    sourceSectionId: ProfileProjectionCandidate['sourceSectionId'];
    sourceItemIndex: number;
    sourceRecord: AgentSourceRecord;
  }>;
}

const ADD_ROW_LABEL_PATTERN = /^(?:\u65b0\u589e|\u6dfb\u52a0)(?:\u4e00\u884c|\u884c|\u4e00\u6761|\u6210\u5458|\u7ecf\u5386|\u8bb0\u5f55|\u5956\u52b1|\u83b7\u5956|\u6210\u679c|\u8003\u8bd5)?$/;
const ENGLISH_ADD_ROW_LABEL_PATTERN = /^(?:addrow|additem|addrecord|addaward|addexperience|addmember)$/;

export function isAddRowLabel(value: string | undefined): boolean {
  const normalized = (value ?? '').replace(/\s+/g, '').toLowerCase();
  return ADD_ROW_LABEL_PATTERN.test(normalized) || ENGLISH_ADD_ROW_LABEL_PATTERN.test(normalized);
}

const IDENTITY_KEYS: Record<string, string[]> = {
  language: ['考试名称', '外语考试', '外语水平', '外语等级', '考试类型'],
  family: ['姓名', '成员姓名', '家庭成员姓名'],
  education_career: ['学校或工作单位', '起始时间', '结束时间'],
  research_training: ['项目名称', '起止时间'],
  internship_practice: ['实习实践单位', '起止时间'],
  social_work: ['社会工作名称', '起止时间'],
  published_papers: ['论文标题', '论文名称', '作者'],
  granted_patents: ['专利名称', '专利权人'],
  subject_competitions: ['获奖项目名称', '竞赛名称', '获奖人'],
  honors_awards: ['获奖名称'],
  '项目经历': ['项目名称', '实习实践单位', '社会工作名称', '起止时间'],
  '论文情况': ['论文标题', '论文名称', '作者'],
  '获奖情况': ['获奖项目名称', '获奖名称', '竞赛名称', '获奖人'],
  '学术成果': ['项目名称', '论文标题', '论文名称', '专利名称', '获奖项目名称', '竞赛名称'],
  '奖励情况': ['获奖名称'],
};

export function getSectionIdentityKeys(sectionId: string | undefined, groupLabel = ''): string[] {
  return [...(IDENTITY_KEYS[sectionId ?? ''] ?? IDENTITY_KEYS[groupLabel] ?? ['姓名', '名称', '项目名称'])];
}

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

function repeatableGroupKind(label: string | undefined): string {
  const value = normalize(label);
  if (/\u5bb6\u5ead.*\u6210\u5458|\u5bb6\u5ead\u60c5\u51b5|\u4e3b\u8981\u6210\u5458/.test(value)) return 'family';
  if (/\u5916\u8bed|\u8bed\u8a00.*\u6c34\u5e73|\u82f1\u8bed.*\u6210\u7ee9/.test(value)) return 'language';
  if (/\u8bba\u6587/.test(value)) return 'papers';
  if (/\u83b7\u5956|\u5956\u52b1|\u8363\u8a89|\u7ade\u8d5b/.test(value)) return 'awards';
  if (/\u9879\u76ee|\u79d1\u7814\u8bad\u7ec3|\u79d1\u7814\u5b9e\u8df5/.test(value)) return 'projects';
  if (/\u5b66\u4e60.*\u5de5\u4f5c.*\u7ecf\u5386|\u6559\u80b2\u7ecf\u5386/.test(value)) return 'education-career';
  return '';
}

export function sameRepeatableGroupLabel(left: string | undefined, right: string | undefined): boolean {
  if (sameText(left, right)) return true;
  const leftKind = repeatableGroupKind(left);
  return Boolean(leftKind && leftKind === repeatableGroupKind(right));
}

function sourceRecordFor(block: BlockCategory, sourceItemIndex: number): AgentSourceRecord {
  const fields = Object.fromEntries((block.items[sourceItemIndex]?.fields ?? [])
    .map((field) => [field.key.trim(), field.value.trim()] as const)
    .filter(([key, value]) => Boolean(key && value)));
  const configuredId = block.sectionId?.trim();
  const categoryId = configuredId || getProfileProjectionSourceSectionId(block);
  const categoryLabel = block.title.trim() || categoryId;
  const recordPrefix = configuredId || `${categoryId}:${categoryLabel}`;
  return {
    recordId: `${recordPrefix}:${sourceItemIndex}`,
    categoryId,
    categoryLabel,
    itemIndex: sourceItemIndex,
    fields,
    searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
  };
}

function sourceGroups(blocks: BlockCategory[], textFields: TextField[]): RepeatableSourceGroup[] {
  const groups = blocks.flatMap((block) => {
    const section = getBlockSection(block);
    const origins = block.items.map((_item, sourceItemIndex) => ({
      sourceSectionId: getProfileProjectionSourceSectionId(block),
      sourceItemIndex,
      sourceRecord: sourceRecordFor(block, sourceItemIndex),
    }));
    if (!section || section.kind !== 'repeat') {
      return block.items.length > 0 && block.title.trim()
        ? [{ label: block.title, sectionId: block.sectionId, items: block.items, origins }]
        : [];
    }
    return [{ label: section.title, sectionId: section.id, items: block.items, origins }];
  });
  if (!groups.some((group) => group.label === '外语水平')) {
    const inferred = inferLanguageItems(textFields);
    if (inferred.length > 0) groups.push({
      label: '外语水平',
      sectionId: 'language',
      items: inferred,
      origins: inferred.map((item, sourceItemIndex) => {
        const fields = Object.fromEntries(item.fields
          .map((field) => [field.key.trim(), field.value.trim()] as const)
          .filter(([key, value]) => Boolean(key && value)));
        return {
          sourceSectionId: 'custom' as const,
          sourceItemIndex,
          sourceRecord: {
            recordId: `custom:外语水平:${sourceItemIndex}`,
            categoryId: 'custom',
            categoryLabel: '外语水平',
            itemIndex: sourceItemIndex,
            fields,
            searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
          },
        };
      }),
    });
  }
  const sourceBySection = new Map(groups.filter((group) => group.sectionId).map((group) => [group.sectionId!, group]));
  const mergedGroups: RepeatableSourceGroup[] = [
    {
      label: '学习和工作经历',
      sectionId: 'education_career',
      items: [...(sourceBySection.get('education_career')?.items ?? [])],
      origins: [...(sourceBySection.get('education_career')?.origins ?? [])],
    },
    {
      label: '项目经历',
      items: [
        ...(sourceBySection.get('research_training')?.items ?? []),
        ...(sourceBySection.get('internship_practice')?.items ?? []),
        ...(sourceBySection.get('social_work')?.items ?? []),
      ],
      origins: [
        ...(sourceBySection.get('research_training')?.origins ?? []),
        ...(sourceBySection.get('internship_practice')?.origins ?? []),
        ...(sourceBySection.get('social_work')?.origins ?? []),
      ],
    },
    {
      label: '论文情况',
      items: [...(sourceBySection.get('published_papers')?.items ?? [])],
      origins: [...(sourceBySection.get('published_papers')?.origins ?? [])],
    },
    {
      label: '获奖情况',
      items: [
        ...(sourceBySection.get('subject_competitions')?.items ?? []),
        ...(sourceBySection.get('honors_awards')?.items ?? []),
      ],
      origins: [
        ...(sourceBySection.get('subject_competitions')?.origins ?? []),
        ...(sourceBySection.get('honors_awards')?.origins ?? []),
      ],
    },
    {
      label: '学术成果',
      items: [
        ...(sourceBySection.get('research_training')?.items ?? []),
        ...(sourceBySection.get('published_papers')?.items ?? []),
        ...(sourceBySection.get('granted_patents')?.items ?? []),
        ...(sourceBySection.get('subject_competitions')?.items ?? []),
      ],
      origins: [
        ...(sourceBySection.get('research_training')?.origins ?? []),
        ...(sourceBySection.get('published_papers')?.origins ?? []),
        ...(sourceBySection.get('granted_patents')?.origins ?? []),
        ...(sourceBySection.get('subject_competitions')?.origins ?? []),
      ],
    },
    {
      label: '奖励情况',
      items: [
        ...(sourceBySection.get('honors_awards')?.items ?? []),
      ],
      origins: [
        ...(sourceBySection.get('honors_awards')?.origins ?? []),
      ],
    },
  ];
  return [...groups, ...mergedGroups].filter((group) => group.items.length > 0);
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

function identityValueFromRow(sectionId: string | undefined, groupLabel: string, fields: FormFieldInfo[]): string {
  const keys = getSectionIdentityKeys(sectionId, groupLabel);
  const identityField = fields.find((field) => keys.some((key) => sameText(field.columnLabel || field.label, key)));
  return identityField?.value?.trim() ?? '';
}

function identityValueFromItem(sectionId: string | undefined, groupLabel: string, item: BlockItem): string {
  const keys = getSectionIdentityKeys(sectionId, groupLabel);
  const identityField = item.fields.find((field) => keys.some((key) => sameText(field.key, key)));
  return identityField?.value.trim() ?? '';
}

function rowHasValue(fields: FormFieldInfo[]): boolean {
  return fields.some((field) => Boolean(field.value?.trim()));
}

function findMatchingItem(
  sectionId: string | undefined,
  groupLabel: string,
  rowIdentity: string,
  items: BlockItem[],
  claimed: Set<number>,
): number | undefined {
  if (!rowIdentity) return undefined;
  const candidates = items
    .map((item, index) => ({ index, identity: identityValueFromItem(sectionId, groupLabel, item) }))
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
      const rowIdentity = identityValueFromRow(source.sectionId, source.label, rowFields);
      const matchingItem = findMatchingItem(source.sectionId, source.label, rowIdentity, source.items, claimed);
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

export function buildRepeatDialogTargetSchemas(
  fields: FormFieldInfo[],
  observations: RepeatableGroupObservation[],
): TargetFieldSchema[] {
  return observations
    .filter((observation) => observation.dialogVisible || observation.presentation === 'dialog')
    .flatMap((observation) => {
      const groupFields = fields.filter((field) => sameText(
        field.repeatGroup || field.groupLabel,
        observation.groupLabel,
      ));
      const usedIndexes = new Set<number>();
      const orderedFields = observation.fieldLabels.flatMap((label) => {
        const matchIndex = groupFields.findIndex((field, index) => (
          !usedIndexes.has(index)
          && sameText(field.columnLabel || field.label, label)
        ));
        if (matchIndex < 0) return [];
        usedIndexes.add(matchIndex);
        return [groupFields[matchIndex]];
      });
      groupFields.forEach((field, index) => {
        if (!usedIndexes.has(index)) orderedFields.push(field);
      });
      const schemaFields = orderedFields.length > 0
        ? orderedFields.map((field) => {
            const label = (field.columnLabel || field.label || field.ariaLabel || field.placeholder).trim();
            const formatHints = [...new Set([field.dateFormat ?? ''].map((value) => value.trim()).filter(Boolean))];
            const annotations = [...new Set([
              field.hint ?? '',
              field.dateFormat ?? '',
              field.context ?? '',
            ].map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))];
            const options = [...new Set((field.options ?? []).map((value) => value.trim()).filter(Boolean))];
            const forbiddenCharacters = [...new Set((field.forbiddenCharacters ?? []).filter(Boolean))];
            const currentValue = field.value?.trim() ?? '';
            const semanticQuestionParts = [
              field.title ?? '',
              field.ariaLabel ?? '',
              field.context ?? '',
            ].map((value) => value.replace(/\s+/g, ' ').trim())
              .filter((value) => Boolean(value && value !== label));
            const questionText = semanticQuestionParts.length > 0
              ? [observation.groupLabel, label, ...semanticQuestionParts].join(' ')
              : '';
            return {
              key: label,
              label,
              required: Boolean(field.required),
              multiline: field.tag.toLowerCase() === 'textarea' || field.fillMode === 'long',
              ...(currentValue ? { currentValue } : {}),
              ...(field.protected ? { protected: true } : {}),
              ...(options.length > 0 ? { options } : {}),
              ...(field.placeholder.trim() ? { placeholder: field.placeholder.trim() } : {}),
              ...(formatHints.length > 0 ? { formatHints } : {}),
              ...(forbiddenCharacters.length > 0 ? { forbiddenCharacters } : {}),
              ...(field.maxLength != null ? { maxLength: field.maxLength } : {}),
              ...(questionText && questionText !== label ? { questionText } : {}),
              ...(annotations.length > 0 ? { annotations } : {}),
            };
          }).filter((field) => field.key)
        : observation.fieldLabels
            .map((label) => label.trim())
            .filter(Boolean)
            .map((label) => ({ key: label, label }));
      return schemaFields.length > 0
        ? [{ groupLabel: observation.groupLabel, fields: schemaFields }]
        : [];
    });
}

export function buildRepeatDialogTargets(
  plan: RepeatableRecordPlan,
  blocks: BlockCategory[],
  targetSchemas: TargetFieldSchema[] = [],
): RepeatDialogTarget[] {
  const sources = sourceGroups(blocks, []);
  return Object.values(plan.groups)
    .filter((group) => group.missingItemIndexes.length > 0)
    .flatMap((group) => {
      const source = sources.find((candidate) => sameText(candidate.label, group.groupLabel))
        ?? sources.find((candidate) => sameRepeatableGroupLabel(candidate.label, group.groupLabel));
      if (!source) return [];
      const targetSchema = targetSchemas.find((candidate) => sameText(candidate.groupLabel, group.groupLabel))
        ?? targetSchemas.find((candidate) => sameRepeatableGroupLabel(candidate.groupLabel, group.groupLabel));
      const projectedCandidates = targetSchema
        ? projectProfileToTargetSchema(targetSchema, blocks, [])
        : [];
      const records = group.missingItemIndexes
        .map((itemIndex) => ({ itemIndex, item: source.items[itemIndex], origin: source.origins[itemIndex] }))
        .filter((candidate): candidate is {
          itemIndex: number;
          item: BlockItem;
          origin: RepeatableSourceGroup['origins'][number];
        } => Boolean(candidate.item && candidate.origin))
        .map(({ itemIndex, item, origin }) => {
          const recordProjection = projectedCandidates.filter((candidate) => (
            candidate.sourceSectionId === origin.sourceSectionId
            && candidate.sourceItemIndex === origin.sourceItemIndex
          ));
          const projectedFields = targetSchema
            ? targetSchema.fields.flatMap((targetField) => {
                const projected = recordProjection.find((candidate) => candidate.targetFieldKey === targetField.key);
                return projected?.value.trim()
                  ? [{ key: targetField.key, value: projected.value.trim() }]
                  : [];
              })
            : [];
          return {
            itemIndex,
            sourceRecord: origin.sourceRecord,
            fields: projectedFields.length > 0
              ? projectedFields
              : item.fields
                  .filter((field) => field.key.trim() && field.value.trim())
                  .map((field) => ({ key: field.key, value: field.value })),
          };
        })
        .filter((record) => record.fields.length > 0);
      return records.length > 0 ? [{ groupLabel: group.groupLabel, records }] : [];
    });
}

export async function prepareRepeatableRowScan<T extends { index: number; field: FormFieldInfo }>(
  scan: () => Promise<T[]>,
  prepareRows: (targets: RepeatRowTarget[]) => Promise<PrepareRepeatRowsResult>,
  blocks: BlockCategory[],
  textFields: TextField[],
  excludedGroupLabels: ReadonlySet<string> = new Set(),
): Promise<RepeatableRowScanResult<T>> {
  const initialScan = await scan();
  const initialFields = initialScan.map((result) => ({ ...result.field, index: result.index }));
  const targets = buildRepeatRowTargets(planRepeatableRecords(initialFields, blocks, textFields))
    .filter((target) => ![...excludedGroupLabels].some((label) => sameText(label, target.groupLabel)));
  if (targets.length === 0) {
    return {
      scanResults: initialScan,
      preparation: { added: 0, failures: [] },
    };
  }

  const preparation = await prepareRows(targets);
  return {
    scanResults: await scan(),
    preparation,
  };
}
