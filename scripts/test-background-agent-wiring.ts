import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /async function savePageAnalysis\(\s*\n\s*taskId: string,[\s\S]*?applicationTitle = ''/u,
  'savePageAnalysis should accept the live tab title for application identity',
);
assert.match(
  source,
  /title: applicationTitle \|\| scan\.pageLabel/u,
  'saved page analysis should prefer the live application title',
);
assert.match(
  source,
  /savePageAnalysis\(\s*\n\s*task\.id,[\s\S]*?scan\.repeatPlan,\s*\n\s*tab\.title \|\| '',?\s*\n\s*\)/u,
  'handleScan should pass the live tab title into page analysis',
);
assert.match(
  source,
  /savePageAnalysis\(task\.id, payload\.scan, payload\.markers, payload\.checkedIndexes, payload\.repeatPlan, tab\.title \|\| ''\)/u,
  'manual page-analysis save should preserve the live tab title',
);
assert.doesNotMatch(
  source,
  /if \(!usePageAgent && Object\.values\(scan\.repeatPlan\.groups\)/u,
  'enhanced Agent mode must not skip the sequential dynamic-record preparation workflow',
);
assert.match(
  source,
  /if \(Object\.values\(scan\.repeatPlan\.groups\)\.some\(\(group\) => group\.rowsToAdd > 0\)\) \{\s*const preparedScan = await collectTabScan\(tabId, true, true, true\)/u,
  'continuous filling should prepare pending repeatable records before either local or Agent page execution',
);
assert.match(
  source,
  /resolveCascaderOption: CascaderAgentObservation/u,
  'the content executor must have a typed background route for constrained cascader observations',
);
assert.match(
  source,
  /requestModelText\(apiConfig, prompt, \{ timeoutMs: 15_000 \}\)/u,
  'a single cascader decision must have a short bounded API timeout',
);
assert.match(
  source,
  /request\.type === 'resolveCascaderOption'[\s\S]*?handleResolveCascaderOption/u,
  'the cascader decision route must reach the allowlist-validating handler',
);

console.log('background agent wiring tests passed');
