import assert from 'node:assert/strict';

import { computeMaterialReviewState } from '../utils/material-review';

const existingPhoto = [{ index: 0, required: false, filled: true }];
assert.deepEqual(
  computeMaterialReviewState(existingPhoto, new Map(), new Set(), true),
  { materialMode: true, missingRequired: 0, unpreviewed: 1, canConfirm: false },
  'a website-existing upload must still be previewed before continuous filling may advance',
);
assert.deepEqual(
  computeMaterialReviewState(existingPhoto, new Map(), new Set([0]), true),
  { materialMode: true, missingRequired: 0, unpreviewed: 0, canConfirm: true },
);

const selectedCandidate = [{ index: 1, required: true, filled: true, fileRecordId: 42 }];
assert.equal(computeMaterialReviewState(selectedCandidate, new Map(), new Set(), true).unpreviewed, 1);
assert.equal(computeMaterialReviewState(selectedCandidate, new Map([[1, 42]]), new Set(), true).canConfirm, true);
assert.equal(
  computeMaterialReviewState([{ index: 2, required: true, filled: false }], new Map(), new Set(), true).missingRequired,
  1,
);

console.log('material review tests passed');
