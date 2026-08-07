import assert from 'node:assert/strict';
import {
  createApplicationTask,
  getTaskPageAnalysis,
  upsertTaskPageAnalysis,
} from '../utils/application-tasks';
import {
  isCurrentRestoreGeneration,
  shouldRestoreLegacyMarkers,
  derivePageMarkers,
  shouldReusePageAnalysis,
} from '../utils/page-analysis';
import type { FormFieldInfo, MatchResult } from '../utils/matcher';
import type { ApplicationPageAnalysis } from '../utils/page-analysis';
import { semanticPageKey } from '../utils/page-identity';

const analysis = (pageKey: string, capturedAt: number): ApplicationPageAnalysis => ({
  pageKey,
  pageLabel: `Page ${pageKey}`,
  pageUrl: `https://example.test/${pageKey}`,
  pageSignature: `signature-${pageKey}`,
  fields: [],
  matches: [],
  markers: [],
  checkedIndexes: [],
  repeatPlan: { groups: {} },
  ai: {
    configured: false,
    mode: 'fallback',
    attempted: false,
    cached: false,
    reviewed: 0,
    error: '',
  },
  capturedAt,
});

let task = createApplicationTask({
  id: 'recovery-task',
  batchId: 'recovery-batch',
  siteOrigin: 'https://example.test',
  siteTitle: 'Recovery',
  page: {
    id: 'audit-snapshot',
    key: 'page-0',
    label: 'Audited page',
    url: 'https://example.test/page-0',
    signature: 'audit-signature',
    capturedAt: 1,
    fields: [],
    materials: [],
  },
  now: 1,
});

for (let index = 0; index < 31; index++) {
  task = upsertTaskPageAnalysis(task, analysis(`page-${index}`, index));
}

assert.equal(Object.keys(task.pageAnalyses ?? {}).length, 30, 'analysis cache is bounded to newest 30 pages');
assert.equal(getTaskPageAnalysis(task, 'page-0'), null, 'oldest analysis is evicted');
assert.equal(getTaskPageAnalysis(task, 'page-30')?.capturedAt, 30);
assert.equal(task.pages['audit-snapshot'].key, 'page-0', 'analysis eviction must not remove final-audit snapshots');

const previous = task;
const updated = upsertTaskPageAnalysis(task, analysis('page-30', 40));
assert.equal(updated.pageAnalyses?.['page-30'].capturedAt, 40);
assert.equal(previous.pageAnalyses?.['page-30'].capturedAt, 30, 'upsert must not mutate the prior analysis');

const cachedDraft = analysis('page-cache', 50);
const cached = {
  ...cachedDraft,
  pageKey: semanticPageKey({
    url: cachedDraft.pageUrl,
    label: cachedDraft.pageLabel,
    signature: cachedDraft.pageSignature,
  }),
};
assert.equal(shouldReusePageAnalysis(cached, {
  url: cached.pageUrl,
  label: cached.pageLabel,
  signature: cached.pageSignature,
}), true);
assert.equal(shouldReusePageAnalysis(cached, {
  url: cached.pageUrl,
  label: cached.pageLabel,
  signature: 'different-dom-signature',
}), false);

const changedField: FormFieldInfo = {
  index: 0,
  tag: 'input',
  type: 'text',
  name: 'name',
  id: 'name',
  label: 'Name',
  placeholder: '',
  ariaLabel: '',
  context: '',
  value: 'Live value',
  required: false,
  protected: false,
};
const cachedMatch: MatchResult = {
  index: 0,
  kind: 'text',
  fieldKey: 'name',
  value: 'Cached value',
  shortLabel: 'Name',
  confidence: 'high',
  source: 'local',
};
const refreshedMarkers = derivePageMarkers([changedField], [cachedMatch]);
assert.equal(refreshedMarkers[0]?.status, 'mismatch', 'live field changes must restamp cached markers');

assert.equal(
  shouldRestoreLegacyMarkers('unverified'),
  false,
  'a matching cached analysis with an unverifiable live refresh must suppress legacy marker fallback',
);
assert.equal(
  shouldRestoreLegacyMarkers('missing'),
  true,
  'legacy markers remain available only when no matching cached analysis exists',
);
assert.equal(
  isCurrentRestoreGeneration(2, 1),
  false,
  'an older restore generation cannot paint after a newer generation supersedes it',
);
assert.equal(isCurrentRestoreGeneration(2, 2), true);

console.log('page analysis recovery tests passed');
