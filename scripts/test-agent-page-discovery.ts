import assert from 'node:assert/strict';

import {
  beginOrRecordAgentPageDiscovery,
  decideAgentPageDiscoveryNavigation,
  markAgentPageDiscoveryExecuting,
  markAgentPageDiscoveryReturning,
} from '../utils/agent/page-discovery';

const first = beginOrRecordAgentPageDiscovery(undefined, {
  pageKey: 'basic',
  url: 'https://example.test/app#/basic',
});
assert.equal(first.alreadyVisited, false);
assert.deepEqual(first.checkpoint, {
  phase: 'collecting',
  startPageKey: 'basic',
  startUrl: 'https://example.test/app#/basic',
  visitedPageKeys: ['basic'],
});

const second = beginOrRecordAgentPageDiscovery(first.checkpoint, {
  pageKey: 'education',
  url: 'https://example.test/app#/education',
});
assert.deepEqual(second.checkpoint.visitedPageKeys, ['basic', 'education']);
assert.equal(decideAgentPageDiscoveryNavigation({
  clicked: true,
  advanced: true,
  alreadyVisited: false,
}), 'continue-collecting');
assert.equal(decideAgentPageDiscoveryNavigation({
  clicked: false,
  advanced: false,
  alreadyVisited: false,
}), 'plan-and-return');
assert.equal(decideAgentPageDiscoveryNavigation({
  clicked: true,
  advanced: false,
  alreadyVisited: false,
}), 'fallback-execution');
assert.equal(decideAgentPageDiscoveryNavigation({
  clicked: true,
  advanced: true,
  alreadyVisited: true,
}), 'fallback-execution');

const returning = markAgentPageDiscoveryReturning(second.checkpoint);
assert.equal(returning.phase, 'returning');
assert.equal(returning.startUrl, first.checkpoint.startUrl);
const executing = markAgentPageDiscoveryExecuting(returning);
assert.equal(executing.phase, 'executing');
assert.deepEqual(executing.visitedPageKeys, ['basic', 'education']);

console.log('agent page discovery tests passed');
