# 精确重复资料分组与目标表适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 将旧的三组通用重复资料替换为七组精确资料，提供正确的导入 JSON，并让不同学校的论文、项目、获奖表格通过确定性规则和可控 AI 投影填充，特别支持长问题和大文本框。

**Architecture:** 资料库使用稳定的七组 section ID 和字段定义；网页扫描后建立目标表 schema，先由本地投影器完成精确字段映射，只有歧义或长文本才调用 API。长问题走“相关记录检索→事实摘要→草稿生成”的受限流水线，结果按页面、资料版本、模型和模式缓存，用户修改后的值拥有更高优先级。

**Tech Stack:** TypeScript 5.9, WXT 0.20, IndexedDB（现有 utils/db.ts）, Node/tsx 测试脚本, Chrome/Edge MV3 构建。

## Global Constraints

- 版本从 1.4.0 升到 1.5.0。
- 升级时只删除 section ID experience、academic、awards；不迁移、不删除其他资料、任务、页面缓存、材料或 API 设置。
- 新资料组必须使用：research_training、internship_practice、social_work、published_papers、granted_patents、subject_competitions、honors_awards。
- 学科竞赛的“获奖项目名称”和“竞赛名称”必须是独立字段，禁止合并。
- 缺少来源的目标字段留空或标记需要确认，AI 不得编造日期、等级、排名、分区或主办单位。
- 长文本默认标为需审核；用户手动修改后的值不能被后续扫描或 AI 结果覆盖。
- 不实现提交、确认报名、志愿、导师、承诺、验证码、支付等高风险操作。
- 不把 API Key、身份证号、联系方式或含真实个人资料的 JSON 提交 Git。

---

### Task 1: Replace the profile schema with seven precise repeatable sections

**Files:**
- Modify: utils/profile-schema.ts
- Modify: utils/db.ts:ensureProfileBlocksSeeded
- Modify: package.json (version 1.4.0 → 1.5.0)
- Test: scripts/test-profile-schema.ts (create)

**Interfaces:**
- Produces ProfileSectionId values research_training, internship_practice, social_work, published_papers, granted_patents, subject_competitions, honors_awards.
- Extends ProfileSectionDefinition with required fieldKeys and optional optionalFieldKeys.
- Produces getSectionFieldKeys(id) and getOptionalSectionFieldKeys(id).
- ensureProfileBlocksSeeded() removes only legacy IDs before ensuring the new seven blocks and remains idempotent.

- [ ] Step 1: Write failing schema and seeding tests

    Assert the exact ID list, exact competition field order, legacy removal, custom-block preservation, and idempotence.

- [ ] Step 2: Run the focused test and verify the old schema fails

    Run: npx tsx scripts/test-profile-schema.ts
    Expected: FAIL because experience, academic, and awards are still present.

- [ ] Step 3: Implement the exact section definitions and legacy cleanup

    Define required and optional keys in PROFILE_SECTIONS. In ensureProfileBlocksSeeded, delete only legacy blocks (ID first; exact legacy title fallback when no ID), then seed the seven definitions. Do not print block values.

- [ ] Step 4: Run the focused test and compile

    Run: npx tsx scripts/test-profile-schema.ts and npm run compile. Expected: PASS.

- [ ] Step 5: Commit

    git add utils/profile-schema.ts utils/db.ts package.json scripts/test-profile-schema.ts
    git commit -m "feat: define precise repeatable profile sections"

### Task 2: Make import/export strict and generate the corrected seven-section JSON

**Files:**
- Modify: utils/profile-data.ts
- Modify: entrypoints/options/main.ts:downloadProfileTemplate, importProfileData, renderProfilePage
- Test: scripts/test-profile-data.ts, scripts/test-precise-profile-import.ts
- Create outside Git: 保填-精确七类资料导入.json

**Interfaces:**
- normalizeProfileBlocks validates a known block against required plus optional keys.
- parseProfileImportBundle(rawJson) returns { fields, blocks, warnings }; warnings contain unknown field/section names without values.
- mergeProfileBlocks updates a same-section block without cross-section field merging.
- appendProfileBlocks deduplicates records by same-section field identity.

- [ ] Step 1: Add failing tests for strict field separation

    Assert that a competition item keeps 获奖项目名称 and 竞赛名称 as separate values, unknown keys are warnings, “无” papers/patents become empty arrays, and append mode does not merge unrelated sections.

- [ ] Step 2: Run focused import tests and verify failure

    Run: npx tsx scripts/test-profile-data.ts and npx tsx scripts/test-precise-profile-import.ts.

- [ ] Step 3: Implement section-aware normalization and warnings

    Use getSectionDefinition and optional keys. Add only explicit aliases such as 奖项名称 → 获奖名称; never alias 获奖项目名称 to 获奖名称 or 竞赛名称.

- [ ] Step 4: Replace the download template and write the corrected JSON outside the repository

    Include the user-provided six competition records, twelve honors, three research-training records, two internship-practice records, three social-work records, and empty paper/patent arrays. Do not include API keys.

- [ ] Step 5: Update options import feedback and test it

    Show counts for updated/added/ignored records and unknown field names, without rendering personal values in diagnostics. Keep 导入/更新 JSON and 新增 JSON.

- [ ] Step 6: Commit

    git add utils/profile-data.ts entrypoints/options/main.ts scripts/test-profile-data.ts scripts/test-precise-profile-import.ts
    git commit -m "feat: validate precise profile imports"

### Task 3: Update repeatable record planning and local field matching

**Files:**
- Modify: utils/repeatable-records.ts
- Modify: utils/local-matcher.ts
- Modify: entrypoints/content.ts (generic group/column detection only)
- Test: scripts/test-repeatable-records.ts, scripts/test-local-matcher.ts, scripts/test-precise-profile-matching.ts

**Interfaces:**
- getSectionIdentityKeys(sectionId) returns stable identity fields.
- planRepeatableRecords preserves row bindings when target columns are reordered.
- findFlatMatch/findStructuredMatch return provenance for every match.

- [ ] Step 1: Add failing tests

    Use a row ordered “竞赛名称、获奖项目名称、获奖等级、获奖时间、获奖人”; assert correct binding and single-textarea aggregation from one source item.

- [ ] Step 2: Run focused matcher tests and verify failure

    Run the three focused suites.

- [ ] Step 3: Implement stable identity and aliases

    Replace title-based identity tables with section-ID tables, keep title fallback for custom blocks, and add explicit aliases for target labels such as 奖项名称、奖项级别、奖项等级、项目描述、项目时间段、本人角色、主办单位.

- [ ] Step 4: Preserve user-edited values

    Treat a non-empty user-edited target value as claimed; only fill empty or explicitly stale fields.

- [ ] Step 5: Run tests and commit

    Run focused suites and npm run compile, then commit with fix: match precise repeatable fields by semantics.

### Task 4: Add target-schema projection for other school layouts

**Files:**
- Create: utils/profile-projections.ts
- Modify: entrypoints/content.ts
- Modify: utils/matcher.ts
- Test: scripts/test-profile-projections.ts

**Interfaces:**

    export interface TargetFieldSchema {
      groupLabel: string;
      fields: Array<{ key: string; label: string; required?: boolean; multiline?: boolean }>;
    }

    export interface ProfileProjectionCandidate {
      sourceSectionId: ProfileSectionId;
      sourceItemIndex: number;
      sourceFieldKeys: string[];
      targetFieldKey: string;
      value: string;
      confidence: number;
      reason: string;
      needsReview: boolean;
    }

    export function projectProfileToTargetSchema(
      target: TargetFieldSchema[],
      blocks: BlockCategory[],
      textFields: TextField[],
    ): ProfileProjectionCandidate[];

- [ ] Step 1: Write failing projection tests

    Cover 论文情况, 项目经历, and 获奖情况; assert one target group can draw from several source sections and each candidate keeps source section/item provenance.

- [ ] Step 2: Implement deterministic projections

    Map exact fields and controlled aliases first. For a target 获奖名称 field, use page context and source type; do not silently concatenate fields. Long target fields return candidate sets with provenance instead of writing immediately.

- [ ] Step 3: Integrate projections into content scanning

    Build target schema from scan results, call the projector before AI matching, and pass only unresolved candidates to the existing AI matcher. Keep generic DOM heuristics; do not add site-specific Southeast University rules.

- [ ] Step 4: Run projection tests and commit

    Run npx tsx scripts/test-profile-projections.ts, npm run test:local-matcher, and npm run compile; commit with feat: project profile sections to target form schemas.

### Task 5: Implement flexible long-question API requests

**Files:**
- Create: utils/long-question.ts
- Modify: utils/matcher.ts
- Modify: entrypoints/background.ts
- Modify: utils/ai-request-queue.ts
- Test: scripts/test-long-question.ts, scripts/test-llm-api.mjs

**Interfaces:**

    export type LongQuestionMode = 'fast' | 'standard';

    export interface LongQuestionRequest {
      question: string;
      targetField: string;
      pageContext: string;
      relevantRecords: Array<{ sectionId: string; itemIndex: number; fields: Record<string, string> }>;
      mode: LongQuestionMode;
      maxInputChars: number;
      maxOutputChars: number;
    }

    export interface LongQuestionDraft {
      text: string;
      sourceRefs: Array<{ sectionId: string; itemIndex: number; fieldKeys: string[] }>;
      missingFacts: string[];
      needsReview: true;
    }

    export function chunkLongQuestionContext(text: string, maxChars: number): string[];
    export function buildLongQuestionPrompt(request: LongQuestionRequest, contextChunk: string): string;
    export function mergeLongQuestionDrafts(drafts: LongQuestionDraft[], maxOutputChars: number): LongQuestionDraft;
    export function createLongQuestionCacheKey(request: LongQuestionRequest, profileVersion: string): string;

- [ ] Step 1: Add failing tests

    Assert paragraph-aware chunking, preservation of dates/ranks, two-stage standard mode, and cache-key changes when page/model/mode/profile version changes.

- [ ] Step 2: Implement bounded context retrieval and prompts

    Send only relevant records and explicit target schema. Require missingFacts for absent facts and reject malformed output.

- [ ] Step 3: Integrate API mode and cache

    Reuse getApiMode and the request queue. Fast mode is one bounded request; standard mode summarizes chunks before drafting. Cache successful reviewable results by page identity, field fingerprint, profile version, model, and mode.

- [ ] Step 4: Preserve manual edits and fallback

    Record a user-edit checkpoint. Never apply a later draft if the current value differs from the last extension-written value. On 502, timeout, or malformed output, leave the field untouched and show retry.

- [ ] Step 5: Run tests and commit

    Run npx tsx scripts/test-long-question.ts, npm run test:llm-api, and npm run compile; commit with feat: support bounded long-question AI drafts.

### Task 6: Update options UI and corrected personal-data JSON

**Files:**
- Modify: entrypoints/options/main.ts
- Modify: entrypoints/options/style.css only if needed
- Create outside Git: 保填-精确七类资料导入.json
- Test: scripts/test-profile-data.ts and manual options smoke checklist

- [ ] Step 1: Render optional fields

    Required fields appear first; optional fields are in a collapsible 其他可选字段 area. Empty optional fields are editable but omitted from compact summaries.

- [ ] Step 2: Show import warnings

    Display counts for updated, added, ignored-empty records and unknown field names; do not display personal values in diagnostics.

- [ ] Step 3: Generate the corrected JSON outside Git

    Use the supplied data. Competition records keep separate project and contest names; papers and patents use empty items; optional fields are populated only when explicitly supplied.

- [ ] Step 4: Verify round trip

    Export the imported data, parse it again, and assert section IDs, field order, record counts, and competition field separation. Keep the JSON outside Git.

### Task 7: Version, build, regression verification, and handoff

**Files:**
- Modify: package-lock.json if npm metadata changes
- Build: WXT output from npm run build
- Test: all existing suites plus new focused suites

- [ ] Step 1: Run focused suites

    npx tsx scripts/test-profile-schema.ts
    npx tsx scripts/test-precise-profile-import.ts
    npx tsx scripts/test-precise-profile-matching.ts
    npx tsx scripts/test-profile-projections.ts
    npx tsx scripts/test-long-question.ts

- [ ] Step 2: Run existing regression suites

    Run the existing test:* scripts for profile, matcher, repeatable rows/dialogs, tasks, page recovery, audit, AI queue, materials, audit view model, and page identity.

- [ ] Step 3: Compile, build, and audit

    Run npm run compile, npm run build, and npm audit --omit=dev --audit-level=high. Confirm built manifest is 1.5.0 and no sensitive files are staged.

- [ ] Step 4: Commit and tag

    Stage only source and test files, commit with feat: add precise profile sections and target schema AI mapping, then create tag v1.5.0.

- [ ] Step 5: Handoff

    Provide corrected JSON path, build output path, exact Edge/Chrome reload steps, and explicitly state whether real logged-in page testing was actually performed.

