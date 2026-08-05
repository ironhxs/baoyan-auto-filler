# Privacy Policy for 保填

**Last updated:** August 5, 2026

## Overview

保填 is a browser extension that helps users fill web forms using local matching and optional LLM-powered semantic matching. We respect your privacy and are committed to protecting your personal data.

## Data Collection

**We do not collect any user data.** The extension does not send any data to us or any server controlled by the developer.

All data processed by the extension remains on your device.

## Data Storage

The extension stores the following data **locally on your device only**:

- **Personal information**: Name, phone, email, address, and other fields you voluntarily enter in the settings page. Stored in your browser's IndexedDB.
- **API configuration**: API endpoint URL, API key, and model name you provide. Stored in `chrome.storage.local`.
- **Uploaded documents**: Images and PDF files you upload for document management. Stored in your browser's IndexedDB.

This data is never transmitted to any server except as described in the next section.

When a page contains a clearly labeled file upload field, the extension may compare that field's local page text with local document filenames, descriptions, and categories. This comparison happens entirely in the browser. A suggested file is attached only after the user explicitly selects it in the preview; background multi-step filling never uploads documents.

## External API Usage

When you use the form filling feature, the extension sends the following data to **the LLM API endpoint you configure yourself**:

- Form field metadata (label, placeholder, name, id) extracted from the current page
- Your stored personal information (key-value pairs)

When **AI Enhanced Review** is enabled, a manual page scan sends all safely scanned form fields to the configured API for semantic matching. This can include a field's visible current value so the extension can compare already-filled content with the user's saved profile. If AI Enhanced Review is disabled, only unresolved safe fields are sent. CAPTCHA, payment, agreement, final-submission, preference, and advisor-selection controls are excluded from AI matching.

This data is sent solely to the API endpoint and API key that **you provide**. We have no access to, visibility into, or control over your API communications. We do not operate any intermediary servers.

## Third-Party Services

The extension does not integrate with any third-party analytics, tracking, or advertising services.

## Data Deletion

You can delete all your data at any time by:

1. Opening the extension's settings page
2. Removing your personal information and documents individually, or
3. Uninstalling the extension from your browser (this removes all stored data)

## Changes

If we update this privacy policy, we will revise the "Last updated" date at the top of this page.

## Contact

If you have questions about this privacy policy, please open an issue on [GitHub](https://github.com/kalinplus/auto-filler/issues).
