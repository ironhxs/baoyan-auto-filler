import { inferAgentPageIntent, type AgentPageIntent, type AgentSourceRecord } from './profile-retriever';
import type {
  AgentFieldGroup,
  AgentPagePlan,
  AgentPageSnapshot,
  AgentPlannedAction,
  AgentReviewItem,
} from './types';

export interface AgentPlanningInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

export interface AgentPlanningChunk extends AgentPlanningInput {
  chunkId: string;
}

export interface AgentPlanningChunkOptions {
  maxFields?: number;
  maxRows?: number;
}

const DEFAULT_MAX_FIELDS = 18;
// Chrome MV3 terminates a service-worker fetch that takes too long to respond.
// Two complete rows keep the real relay comfortably below that browser limit
// while preserving the semantic unit of a repeatable record.
const DEFAULT_MAX_ROWS = 2;

const INTENT_CATEGORY_IDS: Partial<Record<AgentPageIntent, string[]>> = {
  family: ['family_members'],
  education_career: ['education_career'],
  language: ['language_skills'],
  project: ['research_training', 'internship_practice', 'social_work', 'project_experience'],
  publication: ['published_papers'],
  patent: ['granted_patents'],
  award: ['subject_competitions', 'honors_awards'],
};

function snapshotForGroup(snapshot: AgentPageSnapshot, group: AgentFieldGroup): AgentPageSnapshot {
  return {
    ...snapshot,
    groups: [group],
  };
}

function recordsForIntent(records: AgentSourceRecord[], intent: AgentPageIntent): AgentSourceRecord[] {
  const ids = INTENT_CATEGORY_IDS[intent];
  if (!ids?.length) return records;
  const filtered = records.filter((record) => ids.includes(record.categoryId));
  return filtered.length > 0 ? filtered : records;
}

function groupWithRows(group: AgentFieldGroup, rows: AgentFieldGroup['rows']): AgentFieldGroup {
  const fields = rows.flatMap((row) => row.fields);
  return {
    ...group,
    fields,
    rows,
  };
}

function groupWithFields(group: AgentFieldGroup, fields: AgentFieldGroup['fields']): AgentFieldGroup {
  return {
    ...group,
    fields,
    rows: [],
  };
}

function makeChunk(
  input: AgentPlanningInput,
  chunkId: string,
  groups: AgentFieldGroup[],
  sourceRecords: AgentSourceRecord[],
): AgentPlanningChunk {
  return {
    chunkId,
    snapshot: {
      ...input.snapshot,
      groups,
    },
    sourceRecords,
    ...(input.fileRecordIds ? { fileRecordIds: [...input.fileRecordIds] } : {}),
  };
}

export function createAgentPlanningChunks(
  input: AgentPlanningInput,
  options: AgentPlanningChunkOptions = {},
): AgentPlanningChunk[] {
  const maxFields = Math.max(1, options.maxFields ?? DEFAULT_MAX_FIELDS);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  const totalFields = input.snapshot.groups.reduce((sum, group) => sum + group.fields.length, 0);
  const largestRowCount = input.snapshot.groups.reduce((largest, group) => Math.max(largest, group.rows.length), 0);
  if (totalFields <= maxFields && largestRowCount <= maxRows) {
    return [makeChunk(input, 'chunk_0', input.snapshot.groups, input.sourceRecords)];
  }

  const chunks: AgentPlanningChunk[] = [];
  const recordOffsets = new Map<AgentPageIntent, number>();
  for (const group of input.snapshot.groups) {
    const intent = inferAgentPageIntent(snapshotForGroup(input.snapshot, group));
    const intentRecords = recordsForIntent(input.sourceRecords, intent);

    if (group.rows.length > 0) {
      const recordOffset = recordOffsets.get(intent) ?? 0;
      const availableRecords = intentRecords.slice(recordOffset);
      const rowCount = Math.min(group.rows.length, availableRecords.length || group.rows.length);
      const rowsPerChunk = Math.max(1, Math.min(maxRows, Math.floor(maxFields / Math.max(1, group.columns.length))));
      for (let rowStart = 0; rowStart < rowCount; rowStart += rowsPerChunk) {
        const rows = group.rows.slice(rowStart, Math.min(rowStart + rowsPerChunk, rowCount));
        const records = availableRecords.length > 0
          ? availableRecords.slice(rowStart, rowStart + rows.length)
          : intentRecords;
        chunks.push(makeChunk(
          input,
          `chunk_${chunks.length}`,
          [groupWithRows(group, rows)],
          records,
        ));
      }
      if (availableRecords.length > 0) recordOffsets.set(intent, recordOffset + rowCount);
      continue;
    }

    for (let fieldStart = 0; fieldStart < group.fields.length; fieldStart += maxFields) {
      const fields = group.fields.slice(fieldStart, fieldStart + maxFields);
      chunks.push(makeChunk(
        input,
        `chunk_${chunks.length}`,
        [groupWithFields(group, fields)],
        intentRecords,
      ));
    }
  }
  return chunks;
}

function namespaceAction(action: AgentPlannedAction, prefix: string): AgentPlannedAction {
  return { ...action, actionId: `${prefix}:${action.actionId}` };
}

function namespaceReviewItem(item: AgentReviewItem, prefix: string): AgentReviewItem {
  return {
    ...item,
    reviewId: `${prefix}:${item.reviewId}`,
    ...(item.actionId ? { actionId: `${prefix}:${item.actionId}` } : {}),
  };
}

export function mergeAgentChunkPlans(
  chunks: AgentPlanningChunk[],
  plans: AgentPagePlan[],
  snapshotFingerprint: string,
  profileFingerprint: string,
): AgentPagePlan {
  if (chunks.length !== plans.length) {
    throw new Error('Agent chunk plans do not match the planning requests');
  }
  return {
    version: 1,
    pageKey: chunks[0]?.snapshot.pageKey ?? plans[0]?.pageKey ?? '',
    snapshotFingerprint,
    profileFingerprint,
    actions: plans.flatMap((plan, index) => plan.actions.map((action) => (
      namespaceAction(action, chunks[index].chunkId)
    ))),
    reviewItems: plans.flatMap((plan, index) => plan.reviewItems.map((item) => (
      namespaceReviewItem(item, chunks[index].chunkId)
    ))),
  };
}
