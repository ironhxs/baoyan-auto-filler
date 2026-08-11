import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /const capturedIdentity = domControlIdentity\(el\);\s*const trigger = findSelectionTrigger\(el\)/u,
  'stable control identity must be captured before opening a rerendering selector',
);
assert.match(
  source,
  /type: 'resolveCascaderOption',[\s\S]*?visibleOptions/u,
  'the content executor must send only an observation with visible options to the background Agent',
);
assert.match(
  source,
  /for \(let replan = 0; replan < 2; replan\+\+\)/u,
  'Agent cascader replanning must remain bounded to two decisions',
);
assert.match(
  source,
  /branchLabels\.slice\(0, 60\)/u,
  'local first-level exploration must remain bounded',
);
assert.match(
  source,
  /if \(verified && resolvedPath\.length > 0\) await saveCascaderPath/u,
  'a resolved path must only be cached after authoritative page readback',
);
assert.match(
  source,
  /await forgetCascaderPath\(cacheScope\)/u,
  'failed cached paths must be evicted',
);

console.log('cascader content wiring tests passed');
