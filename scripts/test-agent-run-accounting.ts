import assert from 'node:assert/strict';

import { accountAgentRun } from '../utils/agent/run-accounting';

assert.deepEqual(accountAgentRun(12, 27), {
  totalFilled: 39,
  pageFilled: 27,
});
assert.deepEqual(accountAgentRun(12, 0), {
  totalFilled: 12,
  pageFilled: 0,
});

console.log('agent run accounting tests passed');
