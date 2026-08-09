import assert from 'node:assert/strict';

import { inferImageMimeType } from '../utils/image-mime';

assert.equal(inferImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
assert.equal(inferImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
assert.equal(inferImageMimeType(new TextEncoder().encode('GIF89a')), 'image/gif');
assert.equal(inferImageMimeType(new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])), 'image/webp');
assert.equal(inferImageMimeType(new TextEncoder().encode('%PDF-1.7')), '');
assert.equal(inferImageMimeType(new Uint8Array([])), '');

console.log('image MIME tests passed');
