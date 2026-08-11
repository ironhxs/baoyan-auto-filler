import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const snapshot = await readFile(new URL('../utils/agent/page-snapshot.ts', import.meta.url), 'utf8');

assert.match(background, /prepareRepeatables = true/u);
assert.match(background, /collectTabScan\(tab\.id, true, true, false\)/u);
assert.equal(
  [...background.matchAll(/collectTabScan\(tabId, true, true, false\)/gu)].length >= 2,
  true,
  'continuous filling must collect and retry the current page read-only before Agent planning',
);
assert.match(background, /observeRepeatGroups/u);
assert.match(content, /type: 'observeRepeatGroups'/u);
assert.match(content, /function observeRepeatGroups\(/u);
assert.match(content, /type: 'getAgentPageContext'/u);
assert.match(content, /function getAgentPageContext\(/u);
assert.match(snapshot, /repeatGroups\?: RepeatableGroupObservation\[\]/u);
assert.equal(background.includes('].slice(0, 30)'), false, 'Agent instructions must not be truncated to an arbitrary 30-item prefix');

console.log('agent preview readonly tests passed');
