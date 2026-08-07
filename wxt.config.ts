import { existsSync } from 'node:fs';
import { defineConfig } from 'wxt';

// chrome-launcher only detects Chrome/Edge/Chromium/Brave.
// For less common Chromium browsers, set CHROME_PATH as fallback.
const CHROMIUM_FALLBACKS = [
  '/Applications/Tabbit.app/Contents/MacOS/Tabbit',
  '/Applications/Arc.app/Contents/MacOS/Arc',
  '/Applications/Opera.app/Contents/MacOS/Opera',
  '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  '/Applications/Ghostery Dawn.app/Contents/MacOS/Ghostery Dawn',
];
for (const p of CHROMIUM_FALLBACKS) {
  if (existsSync(p)) { process.env.CHROME_PATH = p; break; }
}

export default defineConfig({
  manifest: {
    name: '保填',
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>'],
  },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
    },
  },
});
