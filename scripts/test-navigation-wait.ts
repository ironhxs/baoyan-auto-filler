import assert from 'node:assert/strict';

import { waitForPageTransition } from '../utils/navigation-wait';

const original = {
  url: 'https://example.test/application/basic',
  signature: 'basic-fields',
};

{
  let observations = 0;
  const outcome = await waitForPageTransition({
    initial: original,
    readCurrent: async () => {
      observations += 1;
      return observations <= 24
        ? original
        : {
            url: 'https://example.test/application/family',
            signature: 'family-fields',
          };
    },
    timeoutMs: 1_000,
    pollIntervalMs: 1,
  });

  assert.equal(outcome.changed, true, 'a page transition that completes after 20 polls must not be reported as blocked');
  assert.equal(outcome.current.url, 'https://example.test/application/family');
  assert.equal(observations, 25);
}

{
  let observations = 0;
  const outcome = await waitForPageTransition({
    initial: original,
    readCurrent: async () => {
      observations += 1;
      return original;
    },
    timeoutMs: 8,
    pollIntervalMs: 2,
  });

  assert.equal(outcome.changed, false, 'an unchanged page must still time out for real validation failures');
  assert.deepEqual(outcome.current, original);
  assert.ok(observations >= 1);
}

console.log('navigation wait tests passed');
