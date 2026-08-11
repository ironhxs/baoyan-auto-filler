import assert from 'node:assert/strict';
import { buildAgentPreview } from '../utils/agent/preview';
import type { AgentPagePlan, AgentPageSnapshot } from '../utils/agent/types';
import type { AgentSourceRecord } from '../utils/agent/profile-retriever';

const snapshot: AgentPageSnapshot = {
  pageKey: 'preview-page',
  url: 'https://example.test/form',
  title: '项目经历',
  stepText: '',
  instructions: ['项目时间格式：2025-07 至 2026-07'],
  capturedAt: 1,
  groups: [{
    groupId: 'projects',
    label: '项目经历',
    kind: 'repeatable',
    columns: [{ columnId: 'name', label: '项目名称' }],
    fields: [{
      targetId: 'project-name', index: 8, rowIndex: 0, columnId: 'name', label: '项目名称',
      currentValue: '', required: true, protected: false, kind: 'text', options: [],
      placeholder: '', formatHints: [], forbiddenCharacters: [],
    }],
    rows: [{
      rowIndex: 0,
      fields: [{
        targetId: 'project-name', index: 8, rowIndex: 0, columnId: 'name', label: '项目名称',
        currentValue: '', required: true, protected: false, kind: 'text', options: [],
        placeholder: '', formatHints: [], forbiddenCharacters: [],
      }],
    }],
  }],
};

const sources: AgentSourceRecord[] = [{
  recordId: 'research_training:0',
  categoryId: 'research_training',
  categoryLabel: '科研训练',
  itemIndex: 0,
  fields: { 项目名称: 'PRISM-Net' },
  searchText: '项目名称: PRISM-Net',
}];

const plan: AgentPagePlan = {
  version: 1,
  pageKey: snapshot.pageKey,
  snapshotFingerprint: 'snapshot',
  profileFingerprint: 'profile',
  actions: [{
    actionId: 'add-project-row',
    type: 'add_rows',
    groupId: 'projects',
    count: 1,
    confidence: 0.99,
    reason: '资料有一条项目记录',
  }, {
    actionId: 'fill-project-name',
    type: 'fill_row',
    groupId: 'projects',
    rowIndex: 0,
    sourceRecordId: sources[0].recordId,
    values: [{
      targetId: 'project-name',
      value: 'PRISM-Net',
      evidenceFields: ['项目名称'],
      confidence: 0.98,
      needsReview: false,
      reason: '项目名称直接对应',
    }],
  }],
  reviewItems: [],
};

const preview = buildAgentPreview({ snapshot, sourceRecords: sources, plan });
assert.deepEqual(preview.matches.map((match) => ({
  index: match.index,
  value: match.value,
  fieldKey: match.fieldKey,
  source: match.source,
})), [{
  index: 8,
  value: 'PRISM-Net',
  fieldKey: 'research_training:0',
  source: 'ai_reviewed',
}]);
assert.deepEqual(preview.pendingStructureActions.map((action) => action.actionId), ['add-project-row']);
assert.equal(preview.rejectedActionIds.length, 0);
assert.equal(preview.reviewItems.length, 0);

console.log('agent preview tests passed');
