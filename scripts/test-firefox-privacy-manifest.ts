import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firefox = JSON.parse(readFileSync('.output/firefox-mv2/manifest.json', 'utf8'));
const chrome = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
const gecko = firefox.browser_specific_settings?.gecko;

assert.ok(gecko, 'Firefox manifest should define Gecko-specific settings');
assert.equal(gecko.strict_min_version, '140.0', 'Firefox should require the built-in data-consent version');
assert.deepEqual(
  [...(gecko.data_collection_permissions?.required ?? [])].sort(),
  [
    'authenticationInfo',
    'browsingActivity',
    'personallyIdentifyingInfo',
    'websiteContent',
  ].sort(),
  'Firefox should accurately disclose data sent to the user-configured model provider',
);
assert.equal(
  chrome.browser_specific_settings?.gecko?.data_collection_permissions,
  undefined,
  'Chrome manifest should not contain Firefox-only data permissions',
);
assert.equal(chrome.permissions.includes('offscreen'), true, 'Chromium must include the durable Agent model bridge');
assert.equal(firefox.permissions.includes('offscreen'), false, 'Firefox must not declare the Chromium-only offscreen permission');

console.log('Firefox privacy manifest tests passed');
