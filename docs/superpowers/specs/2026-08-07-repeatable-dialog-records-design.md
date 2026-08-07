# Repeatable dialog-record workflow

## Problem

Some application pages render repeatable records inline, while others render an empty table and open a modal or drawer after the user clicks “新增”. The current implementation handles inline rows but stops when the add control opens a record editor. This leaves papers, projects, awards and family members requiring manual entry.

## Goal

For a repeatable profile group with saved records, support both presentation styles:

1. Inline add: click the bounded add-row control, wait for a new editable row, rescan and fill it.
2. Record dialog: click the bounded add control, identify the visible dialog/drawer for the same repeatable group, fill the current saved record by semantic field labels, save that single record, verify the table/record list changed, then continue with the next saved record.

The workflow must remain generic and must not target any school URL, DOM selector, or school-specific copy.

## Safety boundary

The extension may click a record-level `保存/确定/添加` control only when all of the following are true:

- the control is inside a visible dialog or drawer identified as a repeatable group;
- the current record has no protected field, captcha, payment, commitment, mentor, volunteer, final-submit, or application-confirmation control;
- every required dialog field is locally matched and the value can be read back consistently;
- the table/list changes or the dialog closes after the click.

Controls containing final-application meanings such as `提交报名`, `确认报名`, `志愿`, `导师`, `承诺`, `支付`, or captcha actions are never eligible. If any guard fails, the dialog remains open and the task pauses with a clear reason for manual handling.

## Data flow

`collectTabScan` still performs an initial DOM scan and builds the identity-first repeat plan. Each missing item is passed to content preparation as a bounded target. Content tries inline addition first. If a visible repeat-group dialog appears, it returns a dialog preparation state. Background then sends the current item’s saved fields to content, which:

1. scans only the visible dialog/drawer;
2. matches fields by normalized semantic labels and aliases, independent of display order;
3. fills non-protected fields;
4. reads the values back and checks required fields;
5. clicks only the guarded record-level save control;
6. waits for dialog close or a new repeatable row/list item;
7. returns a per-item result and repeats for the remaining missing items.

After all preparation results return, the page is scanned again. Normal local matching and optional AI review then operate on the post-addition fields. Identity-bound repeatable matches remain authoritative; AI can annotate or review them but cannot rebind their row identity.

## Failure handling

- No visible add control: return a group-specific failure.
- Add click opens neither a row nor a repeat-group dialog: return a failure without guessing.
- Dialog fields are ambiguous or required fields cannot be verified: leave the dialog open and pause.
- Record-level save is missing or unsafe: leave the dialog open and pause.
- Save closes the dialog but no record appears after a bounded wait: return an unverifiable failure and do not retry blindly.

Each result includes the group label, saved item index, presentation mode (`inline` or `dialog`), fields filled, and a short failure reason when applicable. No sensitive values are written to logs.

## Testing

- Pure tests for dialog field matching with reordered subfields and protected-field rejection.
- Pure tests for safe record-level save-label classification and final-submit rejection.
- Regression test for the CET-4/CET-6 reversed-row case where AI proposes the other row’s date.
- Existing inline row-addition and repeatable-record tests remain green.
- Real Edge no-submit QA verifies one paper/project/award record can be added through a dialog, the row is read back, and no final application control is clicked.
