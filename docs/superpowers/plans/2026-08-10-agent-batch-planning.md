# 保填 Agent 2.1 跨页全局规划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“识别并预览”和“连续填写”共享同一套 Agent 页面蓝图、证据校验与安全执行协议，并让连续填写先完整读取所有可达页面的题目与提示，再生成一次跨页全局计划后逐页执行。

**Architecture:** 保留现有 `AgentPagePlan` 与白名单动作协议，把 `AgentPageSnapshot` 扩展为完整、可复用的页面语义蓝图；在其外层新增 `ApplicationBatchBlueprint` 与 `AgentBatchPlan`，连续填写采用“只读收集 → 全局规划 → 指纹校验 → 逐页执行 → 最终审核”的持久化状态机。单页预览调用相同的页面规划器并缓存经过本地校验的计划，但不执行写入；后续单页填充复用该精确计划。

**Tech Stack:** TypeScript 5.9、WXT 0.20、Chrome/Edge/Firefox WebExtension MV3、IndexedDB、`chrome.storage.local`、现有 OpenAI-compatible Responses/Chat Completions 模型桥、Node `assert` + `tsx` 脚本测试、Puppeteer 真实浏览器验收。

## Global Constraints

- 发布版本固定升级为 `2.1.0`，并同步 `package.json`、`package-lock.json`、README 与 release notes。
- 模型调用只使用用户在扩展内配置的中转 API；不接入 Codex Desktop、本地模型或扩展自建服务器。
- 用户已授权把当前报名任务的页面语义与个人资料发送给所配置的模型服务，但发送前必须删除密码、验证码、支付字段、Cookie、Authorization、CSRF、登录凭据和原始模型响应。
- “识别并预览”只允许 observe、retrieve、plan、validate、cache、mark；不得执行 fill、select、upload、add_rows 或导航写操作。
- 连续填写必须在任何字段写入前完成全部可达页面的只读收集；Agent 必须逐页看到完整题干、相邻注释、日期示例、禁用字符、长度限制、字段标签、placeholder、选项、表头、列顺序、重复行结构、当前值、人工保护状态和材料题目。
- 若批次输入超出上下文，只能按完整页面边界分块；单个超大页面可沿用整行安全分块，但每个分块必须重复携带完整页面级题干和注释，不得截断或随机省略页面规则。
- 绝不点击最终提交、确认报名、承诺书、导师或志愿选择、验证码、支付、删除；真实页面测试也遵守这一边界。
- 非空人工值、受保护值和用户在 Agent 写入后手工修改的值不得被覆盖。
- Word/PDF 资料智能导入不属于本版本范围。
- 不把真实个人资料、API Key、登录状态、浏览器缓存或模型原始响应提交到 Git、构建产物或 release。
- 每个实现任务均遵循红灯测试、最小实现、绿灯测试、独立提交；不得用静态假数据测试替代最终真实浏览器测量。

---

## File Map

### 新建文件

- `utils/agent/page-identity.ts`：从页面可见文本与已有资料推断学校、院系、项目，并统一生成 `学校 · 院系 · 项目` 展示名。
- `utils/agent/batch-types.ts`：定义批次蓝图、批次计划、页面子计划、跨页分配、收集状态与执行状态类型。
- `utils/agent/batch-state.ts`：批次状态机的纯函数转换、页面收集顺序、恢复与失效判断。
- `utils/agent/batch-cache.ts`：批次指纹、缓存键、IndexedDB/`chrome.storage.local` 持久化适配。
- `utils/agent/batch-prompt.ts`：生成包含所有页面完整题干和结构的全局规划 prompt 与严格 JSON Schema。
- `utils/agent/batch-chunks.ts`：仅按完整页面边界拆分批次；超大单页分块仍保留完整页面级规则。
- `utils/agent/batch-response.ts`：解析并结构校验 `AgentBatchPlan`，确保 pageKey、页面指纹和动作引用有效。
- `utils/agent/batch-planner.ts`：调用模型、修复一次无效 JSON、合并批次分块结果并校验全局指纹。
- `utils/agent/academic-policy.ts`：页面语义分类、允许来源类别、列级证据约束和长文本学术成果/荣誉表述规则。
- `utils/agent/preview.ts`：生成只读预览结果，把验证后的 Agent 动作转换为现有 `MatchResult`、页面标色和复用计划元数据。
- `utils/marker-layout.ts`：纯函数识别嵌套重复表格的外层题干单元格，保存/恢复 `vertical-align`。
- `scripts/test-agent-page-identity.ts`：学校/院系/项目身份提取与统一展示名测试。
- `scripts/test-agent-batch-state.ts`：收集、规划、执行、恢复、指纹失效状态机测试。
- `scripts/test-agent-batch-prompt.ts`：完整逐页 prompt、敏感字段过滤、分块边界测试。
- `scripts/test-agent-batch-response.ts`：批次 JSON 解析、pageKey 和指纹校验测试。
- `scripts/test-agent-preview.ts`：预览调用 Agent、零写入、精确计划复用测试。
- `scripts/test-agent-academic-policy.ts`：论文、专利、项目、竞赛、荣誉和混合长文本语义分流测试。
- `scripts/test-marker-layout.ts`：题干单元格顶部对齐与样式恢复测试。
- `scripts/test-agent-batch-runtime.ts`：先完整收集、再一次规划、再逐页执行的集成状态机测试。
- `scripts/test-version-release.ts`：版本、README 和 release notes 一致性测试。
- `docs/releases/v2.1.0.md`：2.1.0 用户可见更新说明、安全边界、升级方法和已知限制。

### 修改文件

- `utils/agent/types.ts`：扩展页面快照的身份、题干、注释、局部 HTML、材料语义；引用批次类型。
- `utils/agent/page-snapshot.ts`：完整保留每个字段的题干上下文、表格列语义、当前值和保护状态。
- `utils/agent/planner-prompt.ts`：单页 prompt 使用完整页面蓝图和统一学术语义政策。
- `utils/agent/planner-chunks.ts`：单页分块保留完整页面级信息，避免每块丢失题干。
- `utils/agent/planner-response.ts`：调用共享学术政策验证目标列与来源类别。
- `utils/agent/planner.ts`：复用页面蓝图指纹和批次规划所需的规范化辅助函数。
- `utils/agent/policy.ts`：复用 `academic-policy.ts`，继续执行证据、人工值、整行原子性和高风险动作校验。
- `utils/agent/cache.ts`：升级 Agent 协议版本，并将完整页面身份、API 模式和 Fast 设置纳入失效条件。
- `utils/agent/runtime.ts`：支持传入已验证页面计划，从而让预览后的填充不再次询问模型。
- `utils/application-tasks.ts`：保存学校/院系/项目身份、批次蓝图、批次计划和页面级执行检查点。
- `utils/page-analysis.ts`：页面分析保存 Agent 计划元数据、快照指纹和预览来源。
- `utils/audit-view-model.ts`：统一使用学校/院系/项目展示名并显示批次阶段。
- `entrypoints/content.ts`：采集完整页面提示；添加布局中立标色和可恢复题干顶部对齐；提供只读导航观察消息。
- `entrypoints/background.ts`：统一预览路径；实现批次收集/规划/执行状态机；按指纹选择缓存；停止最终提交前导航。
- `entrypoints/popup/main.ts`：删除三种填充策略；显示 Agent 预览来源、批次阶段和统一任务名称。
- `entrypoints/popup/style.css`：删除 fill-policy 样式；修复预览列表换行和布局；新增批次阶段样式。
- `entrypoints/audit/main.ts`：展示学校/院系/项目、跨页分配来源、计划/回读状态。
- `entrypoints/audit/style.css`：适配更长任务名称和批次状态。
- `scripts/test-agent-page-snapshot.ts`：增加完整题干、身份和材料信息断言。
- `scripts/test-agent-planner-chunks.ts`：增加每个分块保留完整页面规则的断言。
- `scripts/test-agent-runtime.ts`：增加复用预览计划、不重复调用模型的断言。
- `scripts/test-agent-ui.ts`：删除三策略 UI 断言，增加单一智能策略和批次阶段断言。
- `scripts/test-application-tasks.ts`：增加身份、批次蓝图和执行恢复持久化断言。
- `scripts/test-agent-policy.ts`：把现有学术映射断言迁移到共享政策并增加严格来源约束。
- `scripts/test-page-identity.ts`：保留 SPA 页面 key 测试并增加批次页面指纹测试。
- `package.json`：版本 `2.1.0`，注册新增测试脚本。
- `package-lock.json`：同步顶层版本 `2.1.0`。
- `README.md`、`README.en.md`：更新 Agent 2.1 工作流、隐私、安全边界、热更新和真实能力说明。

---

### Task 1: 扩展完整页面蓝图与学校/院系/项目身份

**Files:**
- Create: `utils/agent/page-identity.ts`
- Create: `scripts/test-agent-page-identity.ts`
- Modify: `utils/agent/types.ts`
- Modify: `utils/agent/page-snapshot.ts`
- Modify: `scripts/test-agent-page-snapshot.ts`
- Test: `scripts/test-agent-page-snapshot.ts`
- Test: `scripts/test-agent-page-identity.ts`

**Interfaces:**
- Produces: `AgentApplicationIdentity`, `AgentQuestionContext`, `AgentMaterialContext`。
- Produces: `inferAgentApplicationIdentity(input): AgentApplicationIdentity`。
- Produces: `formatAgentApplicationDisplayName(identity): string`。
- Produces: 扩展后的 `buildAgentPageSnapshot(input): AgentPageSnapshot`，供单页和批次规划共同使用。

- [ ] **Step 1: 写身份与完整题干的失败测试**

在 `scripts/test-agent-page-identity.ts` 写入：

```ts
import assert from 'node:assert/strict';
import {
  formatAgentApplicationDisplayName,
  inferAgentApplicationIdentity,
} from '../utils/agent/page-identity';

const identity = inferAgentApplicationIdentity({
  title: '复旦大学研究生报考服务系统',
  visibleTexts: [
    '复旦大学',
    '计算机科学技术学院',
    '2027年全国优秀大学生夏令营',
  ],
  profileInstitution: '合肥工业大学',
});

assert.deepEqual(identity, {
  institutionName: '复旦大学',
  departmentName: '计算机科学技术学院',
  projectName: '2027年全国优秀大学生夏令营',
});
assert.equal(
  formatAgentApplicationDisplayName(identity),
  '复旦大学 · 计算机科学技术学院 · 2027年全国优秀大学生夏令营',
);

assert.equal(formatAgentApplicationDisplayName({
  institutionName: '东南大学',
  departmentName: '',
  projectName: '',
}), '东南大学');

console.log('agent page identity tests passed');
```

在 `scripts/test-agent-page-snapshot.ts` 增加：

```ts
assert.equal(snapshot.identity.institutionName, '复旦大学');
assert.equal(snapshot.identity.departmentName, '计算机科学技术学院');
assert.equal(snapshot.questionContext.fullText.includes('内容中不得含有 |、#'), true);
assert.equal(snapshot.groups[0].rows[0].fields[2].questionText.includes('奖励情况'), true);
assert.equal(snapshot.groups[0].rows[0].fields[2].contextHtml.includes('<script'), false);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npm run test:agent:snapshot
npx tsx scripts/test-agent-page-identity.ts
```

Expected: TypeScript 或运行时失败，提示 `identity`、`questionContext`、`questionText`、`contextHtml` 或身份函数不存在。

- [ ] **Step 3: 定义页面蓝图类型和身份提取实现**

在 `utils/agent/types.ts` 添加：

```ts
export interface AgentApplicationIdentity {
  institutionName: string;
  departmentName: string;
  projectName: string;
}

export interface AgentQuestionContext {
  fullText: string;
  annotations: string[];
  dateExamples: string[];
  forbiddenCharacters: string[];
  maxLength?: number;
}

export interface AgentMaterialContext {
  targetId: string;
  questionText: string;
  existingFiles: string[];
}
```

把 `AgentTargetField` 扩展为：

```ts
questionText: string;
annotations: string[];
contextHtml: string;
selectionMode?: string;
```

把 `AgentPageSnapshot` 扩展为：

```ts
identity: AgentApplicationIdentity;
questionContext: AgentQuestionContext;
visiblePageText: string[];
materials: AgentMaterialContext[];
```

在 `utils/agent/page-identity.ts` 实现学校、院系和项目的可见文本提取；只从页面题目、Logo 文本、面包屑、招生单位字段和明确项目标题中选取，不把用户本科院校误当报考学校。`formatAgentApplicationDisplayName` 过滤空层级并用 ` · ` 连接。

在 `utils/agent/page-snapshot.ts` 让每个字段保留完整 `questionText`、相邻注释数组与清洗后的 `contextHtml`；`questionContext.fullText` 使用去重后的原始可见语义文本，不使用 30 条截断摘要。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
npm run test:agent:snapshot
npx tsx scripts/test-agent-page-identity.ts
npm run compile
```

Expected: 两个测试输出通过，TypeScript 编译通过。

- [ ] **Step 5: 提交页面蓝图改动**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/types.ts utils/agent/page-snapshot.ts utils/agent/page-identity.ts scripts/test-agent-page-snapshot.ts scripts/test-agent-page-identity.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: preserve complete agent page context"
```

---

### Task 2: 定义批次蓝图、全局计划和持久化状态机

**Files:**
- Create: `utils/agent/batch-types.ts`
- Create: `utils/agent/batch-state.ts`
- Create: `utils/agent/batch-cache.ts`
- Create: `scripts/test-agent-batch-state.ts`
- Modify: `utils/application-tasks.ts`
- Modify: `utils/page-analysis.ts`
- Modify: `scripts/test-application-tasks.ts`
- Test: `scripts/test-agent-batch-state.ts`
- Test: `scripts/test-application-tasks.ts`

**Interfaces:**
- Consumes: `AgentPageSnapshot`, `AgentPagePlan`, `AgentApplicationIdentity`。
- Produces: `ApplicationBatchBlueprint`, `AgentBatchPlan`, `AgentBatchCheckpoint`。
- Produces: `createBatchCheckpoint()`, `collectBatchPage()`, `markBatchCollectionComplete()`, `attachBatchPlan()`, `startBatchExecution()`, `advanceBatchExecution()`。
- Produces: `createAgentBatchCacheKey(input): string`。

- [ ] **Step 1: 写批次状态机失败测试**

在 `scripts/test-agent-batch-state.ts` 构造两个完整页面快照并断言：

```ts
const initial = createBatchCheckpoint({
  taskId: 'task-1',
  batchId: 'batch-1',
  identity,
  profileFingerprint: 'profile-1',
  apiFingerprint: 'api-1',
  now: 1,
});
const afterBasic = collectBatchPage(initial, basicSnapshot, 2);
const afterAwards = collectBatchPage(afterBasic, awardsSnapshot, 3);

assert.equal(afterAwards.phase, 'collecting');
assert.deepEqual(afterAwards.pageOrder, ['basic-page', 'awards-page']);
assert.equal(afterAwards.pages['awards-page'].questionContext.fullText.includes('何时何地'), true);

const collected = markBatchCollectionComplete(afterAwards, { complete: true }, 4);
assert.equal(collected.phase, 'planning');
assert.throws(() => startBatchExecution(collected, 5), /batch plan/i);

const planned = attachBatchPlan(collected, batchPlan, 5);
const executing = startBatchExecution(planned, 6);
assert.equal(executing.phase, 'executing');
assert.equal(executing.currentPageKey, 'basic-page');
```

在 `scripts/test-application-tasks.ts` 增加任务持久化断言：

```ts
assert.equal(task.identity.institutionName, 'A 大学');
assert.equal(withBatch.runner?.batch?.phase, 'collecting');
assert.equal(withBatch.runner?.batch?.pages['page-basic'].pageKey, 'page-basic');
assert.equal(task.runner, undefined, 'batch updates must remain immutable');
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-agent-batch-state.ts
npm run test:tasks
```

Expected: 缺少批次类型、状态转换函数和任务字段。

- [ ] **Step 3: 实现批次类型、纯状态转换和持久化字段**

在 `utils/agent/batch-types.ts` 定义：

```ts
export type AgentBatchPhase = 'collecting' | 'planning' | 'executing' | 'paused' | 'complete';

export interface ApplicationBatchBlueprint {
  taskId: string;
  batchId: string;
  identity: AgentApplicationIdentity;
  pageOrder: string[];
  pages: Record<string, AgentPageSnapshot>;
  collectionComplete: boolean;
  stopReason?: string;
  manualPageKeys: string[];
  profileFingerprint: string;
  pageSetFingerprint: string;
  apiFingerprint: string;
}

export interface AgentBatchPlan {
  version: 1;
  batchId: string;
  batchFingerprint: string;
  profileFingerprint: string;
  pagePlans: Record<string, AgentPagePlan>;
  allocations: Array<{
    sourceRecordId: string;
    pageKeys: string[];
    reason: string;
  }>;
  reviewItems: AgentReviewItem[];
}

export interface AgentBatchCheckpoint {
  phase: AgentBatchPhase;
  blueprint: ApplicationBatchBlueprint;
  plan?: AgentBatchPlan;
  currentPageKey?: string;
  completedPageKeys: string[];
  pageCheckpoints: Record<string, AgentCheckpoint>;
  error?: string;
  updatedAt: number;
}
```

`batch-state.ts` 中所有转换均返回深拷贝，不修改输入；重复收集同一 `pageKey` 时更新快照但不重复追加 `pageOrder`；没有 `collectionComplete` 和有效 plan 时禁止进入执行。

`application-tasks.ts` 给 `ApplicationTask` 增加 `identity`，给 `ApplicationRunnerCheckpoint` 增加 `batch?: AgentBatchCheckpoint`；旧任务读取时通过空身份降级，不破坏现有数据。

`batch-cache.ts` 的批次缓存身份包含 `pageOrder`、完整页面快照、资料记录、Base URL、model、providerId、apiMode、fastMode、aiEnhanced 和 Agent 协议版本。

- [ ] **Step 4: 运行批次状态与任务持久化测试**

Run:

```powershell
npx tsx scripts/test-agent-batch-state.ts
npm run test:tasks
npm run compile
```

Expected: 全部通过，旧任务 fixture 仍能被兼容读取。

- [ ] **Step 5: 提交批次数据模型**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/batch-types.ts utils/agent/batch-state.ts utils/agent/batch-cache.ts utils/application-tasks.ts utils/page-analysis.ts scripts/test-agent-batch-state.ts scripts/test-application-tasks.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: persist global agent batch state"
```

---

### Task 3: 构建不丢页面规则的批次 Prompt、分块和响应解析器

**Files:**
- Create: `utils/agent/batch-prompt.ts`
- Create: `utils/agent/batch-chunks.ts`
- Create: `utils/agent/batch-response.ts`
- Create: `utils/agent/batch-planner.ts`
- Create: `scripts/test-agent-batch-prompt.ts`
- Create: `scripts/test-agent-batch-response.ts`
- Modify: `utils/agent/planner-prompt.ts`
- Modify: `utils/agent/planner-chunks.ts`
- Modify: `utils/agent/planner.ts`
- Modify: `scripts/test-agent-planner-chunks.ts`
- Test: `scripts/test-agent-batch-prompt.ts`
- Test: `scripts/test-agent-batch-response.ts`
- Test: `scripts/test-agent-planner-chunks.ts`

**Interfaces:**
- Consumes: `ApplicationBatchBlueprint`, `AgentSourceRecord[]`, `ApiConfig`。
- Produces: `BAOTIAN_BATCH_PLAN_SCHEMA`。
- Produces: `buildAgentBatchPrompt(input): string`。
- Produces: `createAgentBatchPlanningChunks(input): AgentBatchPlanningChunk[]`。
- Produces: `parseAgentBatchPlan(text, context): AgentBatchPlan`。
- Produces: `requestAgentBatchPlan(input, apiConfig, options): Promise<AgentBatchPlan>`。

- [ ] **Step 1: 写完整逐页输入和敏感字段过滤的失败测试**

在 `scripts/test-agent-batch-prompt.ts` 添加：

```ts
const prompt = buildAgentBatchPrompt({ blueprint, sourceRecords, fileRecordIds: [] });

for (const requiredText of [
  '基本信息完整题干',
  '奖励情况完整题干',
  '日期格式：2019-11',
  '内容中不得含有|、#',
  '获奖名称',
  '获奖等级',
  '当前人工修改值',
]) {
  assert.equal(prompt.includes(requiredText), true, `missing complete page rule: ${requiredText}`);
}
assert.equal(prompt.includes('session_cookie=secret'), false);
assert.equal(prompt.includes('Bearer private-token'), false);
assert.equal(prompt.includes('短信验证码 123456'), false);

const chunks = createAgentBatchPlanningChunks({ blueprint, sourceRecords }, { maxPages: 1 });
assert.equal(chunks.length, 2);
assert.equal(chunks[0].blueprint.pageOrder.length, 1);
assert.equal(chunks[0].blueprint.pages['basic-page'].questionContext.fullText, '基本信息完整题干');
assert.equal(chunks[1].blueprint.pages['awards-page'].questionContext.fullText, '奖励情况完整题干');
```

在 `scripts/test-agent-planner-chunks.ts` 增加单页超大表格分块断言：

```ts
for (const chunk of chunks) {
  assert.equal(chunk.snapshot.questionContext.fullText, snapshot.questionContext.fullText);
  assert.deepEqual(chunk.snapshot.instructions, snapshot.instructions);
  assert.deepEqual(chunk.snapshot.identity, snapshot.identity);
}
```

- [ ] **Step 2: 写批次响应解析失败测试**

在 `scripts/test-agent-batch-response.ts` 断言：

```ts
assert.equal(parsed.pagePlans['basic-page'].pageKey, 'basic-page');
assert.throws(
  () => parseAgentBatchPlan(JSON.stringify({ ...valid, pagePlans: { unknown: valid.pagePlans['basic-page'] } }), context),
  /unknown pageKey/i,
);
assert.throws(
  () => parseAgentBatchPlan(JSON.stringify({
    ...valid,
    pagePlans: { 'basic-page': { ...valid.pagePlans['basic-page'], snapshotFingerprint: 'stale' } },
  }), context),
  /fingerprint/i,
);
```

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-agent-batch-prompt.ts
npx tsx scripts/test-agent-batch-response.ts
npm run test:agent:chunks
```

Expected: 新模块不存在，现有单页分块未保留新页面级字段。

- [ ] **Step 4: 实现批次 Schema、prompt 和严格解析**

`batch-prompt.ts` 中每页使用稳定分隔对象：

```ts
const pages = blueprint.pageOrder.map((pageKey) => ({
  pageKey,
  snapshotFingerprint: agentFingerprint(blueprint.pages[pageKey]),
  snapshot: safeAgentPageSnapshot(blueprint.pages[pageKey]),
}));
```

Prompt 明确要求模型全局决定每条资料在各页面的表达和归类，但不能因为资料已用于另一页而省略当前页明确要求的事实。返回结构为单个 `AgentBatchPlan`，其中每个 `pagePlans[pageKey]` 仍是现有 `AgentPagePlan` 动作协议。

`batch-chunks.ts` 先估算页面数量与序列化长度，只在页面边界拆分；如果单页超过阈值，调用现有 `createAgentPlanningChunks()`，并在每块中保留 `identity`、`questionContext`、`instructions`、`visiblePageText` 和 `materials`。

`batch-response.ts` 先检查批次顶层精确键，再逐页调用 `parseAgentPagePlan()`；拒绝未知 pageKey、缺少已收集页面、重复 actionId、页面指纹不一致和不存在的跨页资料引用。

`batch-planner.ts` 使用现有 `requestModelText(apiConfig, prompt, { stream: true })`；第一次结构或语义校验失败时只允许再请求一次修复，修复 prompt 附带本地错误但不放宽证据和安全边界。

- [ ] **Step 5: 运行批次规划与单页分块测试**

Run:

```powershell
npx tsx scripts/test-agent-batch-prompt.ts
npx tsx scripts/test-agent-batch-response.ts
npm run test:agent:chunks
npm run test:agent:response
npm run compile
```

Expected: 所有页面完整题干进入 prompt，敏感内容被移除，分块不丢页面级规则，响应引用全部被本地验证。

- [ ] **Step 6: 提交批次规划协议**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/batch-prompt.ts utils/agent/batch-chunks.ts utils/agent/batch-response.ts utils/agent/batch-planner.ts utils/agent/planner-prompt.ts utils/agent/planner-chunks.ts utils/agent/planner.ts scripts/test-agent-batch-prompt.ts scripts/test-agent-batch-response.ts scripts/test-agent-planner-chunks.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: plan application pages as one agent batch"
```

---

### Task 4: 建立严格的学术成果语义政策

**Files:**
- Create: `utils/agent/academic-policy.ts`
- Create: `scripts/test-agent-academic-policy.ts`
- Modify: `utils/agent/planner-prompt.ts`
- Modify: `utils/agent/batch-prompt.ts`
- Modify: `utils/agent/planner-response.ts`
- Modify: `utils/agent/policy.ts`
- Modify: `scripts/test-agent-policy.ts`
- Test: `scripts/test-agent-academic-policy.ts`
- Test: `scripts/test-agent-policy.ts`

**Interfaces:**
- Produces: `AgentAcademicTargetKind`。
- Produces: `classifyAcademicTarget(snapshot, group, field?): AgentAcademicTargetKind`。
- Produces: `allowedAcademicSourceCategories(kind): ReadonlySet<string>`。
- Produces: `validateAcademicEvidence(input): { valid: boolean; reason?: string }`。
- Produces: `academicPromptRules(): string[]`。

- [ ] **Step 1: 写论文、项目、竞赛、荣誉和混合长文本的失败测试**

在 `scripts/test-agent-academic-policy.ts` 添加：

```ts
assert.equal(classifyAcademicTarget(paperSnapshot, paperGroup), 'paper');
assert.equal(classifyAcademicTarget(projectSnapshot, projectGroup), 'project');
assert.equal(classifyAcademicTarget(competitionSnapshot, competitionGroup), 'competition');
assert.equal(classifyAcademicTarget(honorQuestionSnapshot, honorGroup), 'honor_narrative');
assert.equal(classifyAcademicTarget(mixedAcademicSnapshot, mixedGroup), 'academic_narrative');

assert.equal(validateAcademicEvidence({
  targetKind: 'paper',
  sourceRecord: competitionRecord,
  targetFieldLabel: '论文名称',
  evidenceFields: ['获奖项目名称'],
}).valid, false);

assert.equal(validateAcademicEvidence({
  targetKind: 'project',
  sourceRecord: researchRecord,
  targetFieldLabel: '项目描述',
  evidenceFields: ['项目名称', '项目级别', '排名'],
}).valid, true);

assert.equal(validateAcademicEvidence({
  targetKind: 'honor_narrative',
  sourceRecord: competitionRecord,
  targetFieldLabel: '何时何地何原因受过何种奖励',
  evidenceFields: ['竞赛名称'],
}).valid, false);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-agent-academic-policy.ts
npm run test:agent:policy
```

Expected: 学术政策模块不存在，现有政策仍含宽泛的“论文兼容表格可填竞赛/科研”规则。

- [ ] **Step 3: 实现共享语义分类和证据矩阵**

`academic-policy.ts` 固定以下映射：

```ts
const ALLOWED: Record<AgentAcademicTargetKind, readonly string[]> = {
  paper: ['published_papers'],
  patent: ['granted_patents'],
  project: ['research_training', 'project_experience'],
  competition: ['subject_competitions'],
  honor: ['honors_awards'],
  academic_narrative: [
    'research_training',
    'published_papers',
    'granted_patents',
    'subject_competitions',
    'project_experience',
  ],
  honor_narrative: ['honors_awards'],
  general: [],
};
```

列级约束还必须拒绝：

- 未明确作者顺序时填写“本人排名”；
- 未明确发表/接收状态时填写“论文发表状态”；
- 用竞赛阶段或奖项级别冒充地点；
- 用竞赛/科研记录填论文刊物或会议名称；
- 用项目名称冒充荣誉奖励名称；
- 把奖学金、三好学生放进“学术成果（包括荣获奖项、发表论文、学术活动等）”以外的论文表格。

`planner-prompt.ts` 和 `batch-prompt.ts` 通过 `academicPromptRules()` 使用同一政策文本，删除互相冲突的旧提示；`planner-response.ts` 与 `policy.ts` 都调用 `validateAcademicEvidence()`，模型即使输出错误映射也不能执行。

- [ ] **Step 4: 运行学术政策与现有 Agent 测试**

Run:

```powershell
npx tsx scripts/test-agent-academic-policy.ts
npm run test:agent:policy
npm run test:agent:response
npm run compile
```

Expected: 严格结构只接受匹配类别，混合长文本允许有证据的综合表述，荣誉叙述只使用荣誉记录。

- [ ] **Step 5: 提交学术语义政策**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/academic-policy.ts utils/agent/planner-prompt.ts utils/agent/batch-prompt.ts utils/agent/planner-response.ts utils/agent/policy.ts scripts/test-agent-academic-policy.ts scripts/test-agent-policy.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "fix: enforce academic evidence semantics"
```

---

### Task 5: 让“识别并预览”真正调用 Agent 且保持零写入

**Files:**
- Create: `utils/agent/preview.ts`
- Create: `scripts/test-agent-preview.ts`
- Modify: `utils/agent/runtime.ts`
- Modify: `utils/agent/cache.ts`
- Modify: `utils/page-analysis.ts`
- Modify: `entrypoints/background.ts`
- Modify: `scripts/test-agent-runtime.ts`
- Test: `scripts/test-agent-preview.ts`
- Test: `scripts/test-agent-runtime.ts`

**Interfaces:**
- Consumes: 完整 `AgentPageSnapshot`、资料记录、API 配置和现有页面字段。
- Produces: `planAgentPreview(input): Promise<AgentPreviewResult>`。
- Produces: `AgentPreviewResult { plan, validated, matches, markers, cacheKey, cached }`。
- Extends: `runAgentPage(deps, checkpoint, options?: { suppliedPlan?: AgentPagePlan })`，仅在执行阶段复用预览计划。

- [ ] **Step 1: 写预览调用模型、零执行和计划复用失败测试**

在 `scripts/test-agent-preview.ts` 添加：

```ts
let planned = 0;
let executed = 0;
const preview = await planAgentPreview({
  snapshot,
  sourceRecords,
  apiConfig,
  requestPlan: async () => { planned += 1; return pagePlan; },
  execute: async () => { executed += 1; },
});

assert.equal(planned, 1);
assert.equal(executed, 0, 'preview must never write into the page');
assert.equal(preview.plan.pageKey, snapshot.pageKey);
assert.equal(preview.matches[0].source, 'ai');

const filled = await runAgentPage(runtimeDeps, undefined, { suppliedPlan: preview.plan });
assert.equal(modelPlanCalls, 0, 'fill must reuse the exact validated preview plan');
assert.equal(filled.status, 'complete');
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-agent-preview.ts
npm run test:agent:runtime
```

Expected: `planAgentPreview` 和 `suppliedPlan` 接口不存在。

- [ ] **Step 3: 实现只读预览适配器和计划缓存**

`preview.ts` 顺序固定为：

```ts
const plan = await requestPlan(snapshot, sourceRecords, apiConfig);
const validated = validateAgentPlan(plan, validationContext);
return {
  plan: validated.plan,
  validated,
  matches: agentPlanToMatches(validated.plan, snapshot),
  markers: agentPlanToMarkers(validated, snapshot),
  cacheKey,
  cached,
};
```

该模块不接收 content-script 写入函数；类型上阻断 preview 执行网页动作。`handleScan()` 改为在 API 已配置时构造完整快照并调用 `planAgentPreview()`，把计划、指纹和来源写入 `ApplicationPageAnalysis`；API 不可用时才降级为现有本地简单字段扫描，并在结果中明确 `agentStatus: 'fallback'`。

`runtime.ts` 接收 `suppliedPlan` 后仍执行本地指纹和政策校验；计划 pageKey 或指纹不一致时拒绝复用并重新规划，不能把旧页计划套到新页。

- [ ] **Step 4: 运行预览、运行时、缓存和扫描测试**

Run:

```powershell
npx tsx scripts/test-agent-preview.ts
npm run test:agent:runtime
npm run test:agent:cache
npm run test:page-analysis-recovery
npm run compile
```

Expected: 预览产生 Agent 计划和标色但没有写入；后续填充命中缓存且不重复调用模型。

- [ ] **Step 5: 提交统一预览路径**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/preview.ts utils/agent/runtime.ts utils/agent/cache.ts utils/page-analysis.ts entrypoints/background.ts scripts/test-agent-preview.ts scripts/test-agent-runtime.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: use agent plans for page preview"
```

---

### Task 6: 把连续填写改成“先全页收集，再全局规划，再逐页执行”

**Files:**
- Create: `scripts/test-agent-batch-runtime.ts`
- Modify: `utils/agent/batch-state.ts`
- Modify: `utils/agent/runtime.ts`
- Modify: `utils/navigation-wait.ts`
- Modify: `utils/application-tasks.ts`
- Modify: `entrypoints/content.ts`
- Modify: `entrypoints/background.ts`
- Modify: `scripts/test-navigation-wait.ts`
- Test: `scripts/test-agent-batch-runtime.ts`

**Interfaces:**
- Consumes: `requestAgentBatchPlan()`、`runAgentPage()`、持久化 `AgentBatchCheckpoint`。
- Produces: `runAgentBatch(deps, checkpoint?): Promise<AgentBatchOutcome>`。
- Produces: content-script 只读消息 `observeCurrentPage`、`findSafeNextPageControl`、`restoreCollectedPage`。
- Preserves: `processAutoRun(tabId)` 为现有入口，但内部仅调度批次状态机。

- [ ] **Step 1: 写禁止边收集边填写的失败集成测试**

在 `scripts/test-agent-batch-runtime.ts` 使用两个页面 fixture：

```ts
const events: string[] = [];
const outcome = await runAgentBatch({
  observe: async (pageKey) => {
    events.push(`observe:${pageKey}`);
    return snapshots[pageKey];
  },
  navigateForCollection: async (pageKey) => {
    events.push(`navigate:${pageKey}`);
    return nextPage[pageKey];
  },
  planBatch: async (blueprint) => {
    events.push(`plan:${blueprint.pageOrder.join(',')}`);
    return batchPlan;
  },
  executePage: async (pageKey) => {
    events.push(`execute:${pageKey}`);
    return completeCheckpoint(pageKey);
  },
  save: async () => undefined,
}, initialCheckpoint);

assert.deepEqual(events, [
  'observe:basic',
  'navigate:basic',
  'observe:awards',
  'navigate:awards',
  'plan:basic,awards',
  'execute:basic',
  'execute:awards',
]);
assert.equal(events.findIndex((item) => item.startsWith('execute:')) > events.indexOf('plan:basic,awards'), true);
assert.equal(outcome.status, 'complete');
```

再断言弹窗关闭和标签切换后从已持久化的 `phase: 'collecting'`、`pageOrder` 和 `pages` 恢复，不重新丢弃前页。

- [ ] **Step 2: 写高风险导航和指纹漂移失败测试**

```ts
assert.equal(isSafeCollectionNavigationLabel('下一步'), true);
assert.equal(isSafeCollectionNavigationLabel('保存并下一步'), false);
assert.equal(isSafeCollectionNavigationLabel('确认报名'), false);
assert.equal(isSafeCollectionNavigationLabel('选择导师并下一步'), false);

await assert.rejects(
  () => executeCollectedPage(staleSubplan, currentSnapshot),
  /page fingerprint changed/i,
);
```

这里严格执行设计中的只读收集边界：如果系统的“下一步”会隐式保存当前页，收集阶段不得点击，必须暂停并提示用户人工导航；不能为了“自动遍历”破坏只读保证。

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-agent-batch-runtime.ts
npm run test:navigation-wait
```

Expected: `runAgentBatch` 不存在，现有 `processAutoRun()` 仍会在每页收集后立即匹配或填写。

- [ ] **Step 4: 实现批次运行时和后台调度**

`runAgentBatch()` 按 phase 分派：

```ts
switch (checkpoint.phase) {
  case 'collecting':
    return collectUntilBoundary(deps, checkpoint);
  case 'planning':
    return planCollectedBatch(deps, checkpoint);
  case 'executing':
    return executePlannedPages(deps, checkpoint);
  case 'paused':
  case 'complete':
    return outcomeFromCheckpoint(checkpoint);
}
```

收集阶段每页只调用 DOM 读取、快照构造、持久化和安全导航检测，不调用 `resolveContentFillItems()`、`executeAgentActions()`、文件上传或添加行。收集结束后只调用一次 `requestAgentBatchPlan()`；执行阶段返回每页时先比较当前完整页面指纹与计划中的 `snapshotFingerprint`，一致才调用 `runAgentPage(..., { suppliedPlan })`。

`processAutoRun(tabId)` 只负责互斥锁、获取任务、调用 `runAgentBatch()`、同步 UI 状态和调度恢复。关闭 popup 不终止 service-worker 中已经持久化的任务；切换标签时每个 task/tab binding 独立保存状态。

到达最终审核、提交、承诺、验证码、导师/志愿或无法证明只读的导航控件时，批次进入 `paused`，保留所有已收集页面和全局计划。

- [ ] **Step 5: 运行批次运行时、导航、页面恢复和旧 Agent 测试**

Run:

```powershell
npx tsx scripts/test-agent-batch-runtime.ts
npm run test:navigation-wait
npm run test:page-analysis-recovery
npm run test:agent:runtime
npm run test:agent:execution
npm run compile
```

Expected: 所有写入均发生在完整批次规划之后；恢复不重扫已确认页面；页面指纹漂移时暂停而不是套用旧计划。

- [ ] **Step 6: 提交批次自动化状态机**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/batch-state.ts utils/agent/runtime.ts utils/navigation-wait.ts utils/application-tasks.ts entrypoints/content.ts entrypoints/background.ts scripts/test-agent-batch-runtime.ts scripts/test-navigation-wait.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: collect all pages before agent execution"
```

---

### Task 7: 修复重复表格标色造成的题干下沉并保证可恢复

**Files:**
- Create: `utils/marker-layout.ts`
- Create: `scripts/test-marker-layout.ts`
- Modify: `entrypoints/content.ts`
- Test: `scripts/test-marker-layout.ts`

**Interfaces:**
- Produces: `findRepeatableQuestionCell(fieldElement): HTMLElement | null`。
- Produces: `alignRepeatableQuestionCell(cell): void`。
- Produces: `restoreRepeatableQuestionCell(cell): void`。
- Preserves: 现有 `markField()`、`clearMarkers()` 消息接口。

- [ ] **Step 1: 写样式保存、顶部对齐和恢复失败测试**

在 `scripts/test-marker-layout.ts` 使用最小 DOM fixture 或抽象 style adapter：

```ts
const cell = fakeCell({ inlineVerticalAlign: '', computedVerticalAlign: 'middle' });
alignRepeatableQuestionCell(cell);
assert.equal(cell.style.verticalAlign, 'top');
assert.equal(cell.dataset.baotianOriginalVerticalAlign, '');

restoreRepeatableQuestionCell(cell);
assert.equal(cell.style.verticalAlign, '');
assert.equal('baotianOriginalVerticalAlign' in cell.dataset, false);

const alreadyTop = fakeCell({ inlineVerticalAlign: 'top', computedVerticalAlign: 'top' });
alignRepeatableQuestionCell(alreadyTop);
restoreRepeatableQuestionCell(alreadyTop);
assert.equal(alreadyTop.style.verticalAlign, 'top');
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-marker-layout.ts
```

Expected: 布局辅助模块不存在。

- [ ] **Step 3: 实现布局中立标色和题干单元格恢复**

`entrypoints/content.ts` 的字段标色只使用 `outline` 或 `box-shadow: inset`，不得写 margin、padding、height、display、position 或插入会撑高表格的节点。识别到输入控件位于嵌套重复表格时，找到其外层题干 `<td>/<th>`，记录原始 inline `vertical-align`：

```ts
if (!cell.hasAttribute('data-baotian-original-vertical-align')) {
  cell.setAttribute('data-baotian-original-vertical-align', cell.style.verticalAlign);
}
cell.style.verticalAlign = 'top';
cell.setAttribute('data-baotian-layout-adjusted', 'true');
```

`clearMarkers()` 遍历 `[data-baotian-layout-adjusted]`，恢复空字符串或原始值并删除两个 data 属性。重复调用标色/清除必须幂等。

- [ ] **Step 4: 运行布局和内容脚本相关测试**

Run:

```powershell
npx tsx scripts/test-marker-layout.ts
npm run test:field-context
npm run test:repeatable-dialog
npm run compile
```

Expected: 样式准确恢复，现有字段上下文和重复表格逻辑不退化。

- [ ] **Step 5: 提交标色布局修复**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/marker-layout.ts entrypoints/content.ts scripts/test-marker-layout.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "fix: keep repeatable table markers layout neutral"
```

---

### Task 8: 删除三种填充模式并统一任务名称与 Agent 状态 UI

**Files:**
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`
- Modify: `entrypoints/audit/main.ts`
- Modify: `entrypoints/audit/style.css`
- Modify: `utils/audit-view-model.ts`
- Modify: `utils/application-tasks.ts`
- Modify: `utils/agent/view-model.ts`
- Modify: `scripts/test-agent-ui.ts`
- Modify: `scripts/test-audit-view-model.ts`
- Test: `scripts/test-agent-ui.ts`
- Test: `scripts/test-audit-view-model.ts`

**Interfaces:**
- Consumes: `ApplicationTask.identity`、`formatAgentApplicationDisplayName()`、`AgentBatchCheckpoint.phase`。
- Produces: popup 和 audit 共用的 `displayName` 与阶段标签。
- Removes: `.fill-policy`、`applyFillPolicy()`、保守/标准/尽量填充状态和持久化键。

- [ ] **Step 1: 改写 UI 测试，先要求旧策略完全消失**

在 `scripts/test-agent-ui.ts` 与 `scripts/test-audit-view-model.ts` 添加：

```ts
assert.equal(popupSource.includes('保守'), false);
assert.equal(popupSource.includes('尽量填充'), false);
assert.equal(popupSource.includes('applyFillPolicy'), false);
assert.equal(popupCss.includes('.fill-policy'), false);

const taskView = buildTaskViewModel(taskWithIdentity);
assert.equal(taskView.displayName, '中山大学 · 计算机学院 · 预推免项目');
assert.equal(taskView.batchPhaseLabel, '正在收集全部页面');
```

同时断言预览仍有逐条 checkbox、定位按钮、取消/人工处理入口。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npm run test:agent:ui
npm run test:audit-view-model
```

Expected: 旧三策略文案和逻辑仍存在，任务展示名缺少院系/项目。

- [ ] **Step 3: 删除策略 UI 并统一展示名称**

`popup/main.ts` 删除 fill policy 渲染、事件和持久化读取；默认展示所有经过 Agent 本地验证的安全动作，用户仍可逐条取消勾选。Agent 卡片显示以下阶段：

```text
正在读取当前页面
正在收集全部页面（2/7）
正在生成跨页计划
正在执行（3/7）
等待人工确认
已进入最终审核
```

popup 当前任务、逐页记录和统一审核都调用 `formatAgentApplicationDisplayName(task.identity)`；项目名缺失时显示学校和院系，院系也缺失时只显示学校或系统标题。

修复预览区域文字被表格宽度挤压的问题：标签列允许自然换行，动作按钮列固定最小宽度，长文件名和长题干使用 `overflow-wrap:anywhere`，不得通过绝对定位覆盖左侧文字。

- [ ] **Step 4: 运行 UI 测试和编译**

Run:

```powershell
npm run test:agent:ui
npm run test:audit-view-model
npm run test:tasks
npm run compile
```

Expected: 三策略完全消失，任务名称统一，长题干不会撑乱 popup 布局。

- [ ] **Step 5: 提交 UI 简化和身份展示**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add entrypoints/popup/main.ts entrypoints/popup/style.css entrypoints/audit/main.ts entrypoints/audit/style.css utils/audit-view-model.ts utils/application-tasks.ts utils/agent/view-model.ts scripts/test-agent-ui.ts scripts/test-audit-view-model.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "feat: simplify agent controls and task identity"
```

---

### Task 9: 升级协议、版本、文档和测试入口

**Files:**
- Create: `scripts/test-version-release.ts`
- Create: `docs/releases/v2.1.0.md`
- Modify: `utils/agent/cache.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `README.en.md`
- Test: `scripts/test-version-release.ts`

**Interfaces:**
- Updates: `AGENT_PROTOCOL_VERSION` 从 `7` 升至 `8`，使旧页面/批次计划自动失效。
- Adds: `test:agent:batch-state`、`test:agent:batch-prompt`、`test:agent:batch-response`、`test:agent:batch-runtime`、`test:agent:preview`、`test:agent:academic`、`test:marker-layout`、`test:version-release`。

- [ ] **Step 1: 写版本与文档一致性失败测试**

在 `scripts/test-version-release.ts` 添加：

```ts
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const readme = await readFile('README.md', 'utf8');
const english = await readFile('README.en.md', 'utf8');
const release = await readFile('docs/releases/v2.1.0.md', 'utf8');

assert.equal(pkg.version, '2.1.0');
assert.equal(lock.version, '2.1.0');
assert.equal(lock.packages[''].version, '2.1.0');
assert.match(readme, /先收集全部页面.*跨页规划/s);
assert.match(readme, /不会自动提交/);
assert.match(english, /collect all reachable pages.*global plan/is);
assert.match(release, /2\.1\.0/);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
npx tsx scripts/test-version-release.ts
```

Expected: 当前版本仍是 `2.0.1`，release 文件不存在，README 未描述 2.1 流程。

- [ ] **Step 3: 更新协议、版本、README 和 release notes**

文档必须准确描述：

- 预览现在调用 Agent，但不写网页；
- 连续填写先收集全部可达页面，再统一规划；
- 页面资料会发送给用户自己配置的模型服务，凭据字段会在本地过滤；
- 学术成果按论文、专利、项目、竞赛、荣誉严格分流；
- 不再区分保守/标准/尽量填充；
- 仍不会最终提交、确认、选导师/志愿、处理验证码、支付或删除；
- Edge/Chrome 解压缩扩展更新方法是覆盖同一构建目录后在扩展管理页点“重新加载”，不得重新导入资料；若加载的是旧随机构建目录，需要先切换到新的固定构建目录。

不要宣称尚未完成的 Word/PDF 智能导入或完全适配所有网站。

- [ ] **Step 4: 运行版本测试和编译**

Run:

```powershell
npx tsx scripts/test-version-release.ts
npm run compile
```

Expected: 版本和文档一致，协议版本已失效旧缓存。

- [ ] **Step 5: 提交版本和文档**

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add utils/agent/cache.ts package.json package-lock.json README.md README.en.md docs/releases/v2.1.0.md scripts/test-version-release.ts
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "docs: release baotian agent 2.1.0"
```

---

### Task 10: 全量自动化、双浏览器构建和真实页面验收

**Files:**
- Modify only if verification exposes a concrete defect: files owned by Tasks 1–9
- Record: `docs/releases/v2.1.0.md`
- Verify: `.output/chrome-mv3/`
- Verify: `.output/firefox-mv2/` or the WXT-generated Firefox output directory

**Interfaces:**
- Consumes: 所有新增模块和测试。
- Produces: 可加载的 Chrome/Edge 与 Firefox 构建、真实页面测量记录、干净 Git 状态。

- [ ] **Step 1: 运行所有受影响的测试入口**

Run:

```powershell
npm run test:agent:snapshot
npx tsx scripts/test-agent-page-identity.ts
npx tsx scripts/test-agent-batch-state.ts
npx tsx scripts/test-agent-batch-prompt.ts
npx tsx scripts/test-agent-batch-response.ts
npx tsx scripts/test-agent-batch-runtime.ts
npx tsx scripts/test-agent-preview.ts
npx tsx scripts/test-agent-academic-policy.ts
npx tsx scripts/test-marker-layout.ts
npm run test:agent:chunks
npm run test:agent:response
npm run test:agent:policy
npm run test:agent:runtime
npm run test:agent:execution
npm run test:agent:cache
npm run test:agent:ui
npm run test:tasks
npm run test:page-analysis-recovery
npm run test:audit-view-model
npm run test:navigation-wait
npx tsx scripts/test-version-release.ts
```

Expected: 每个脚本退出码为 0；任何失败必须回到拥有该行为的任务，先增加最小复现断言再修复。

- [ ] **Step 2: 运行仓库完整测试清单**

从 `package.json` 依次运行所有 `test:*` 脚本，但跳过需要真实 API Key 的 `test:llm-api`；真实 API 冒烟测试在用户明确提供当前有效配置且输出脱敏时单独执行。

Expected: 所有离线测试通过，未配置 API 不被伪装成已验证。

- [ ] **Step 3: 运行 TypeScript 编译和双浏览器构建**

Run:

```powershell
npm run compile
npm run build
npm run build:firefox
```

Expected: 三个命令退出码为 0；构建 manifest 显示名称“保填”和版本 `2.1.0`。

- [ ] **Step 4: 检查构建产物不含敏感数据**

Run:

```powershell
Get-ChildItem -Recurse .output -File | Select-String -Pattern 'sk-[A-Za-z0-9_-]{8,}|15666235006|370724200501081419|mail\.hfut\.edu\.cn' -AllMatches
```

Expected: 无匹配。若命中，只能删除由本次实现引入的 fixture/日志/缓存引用，不能删除用户源资料。

- [ ] **Step 5: 在真实页面执行只读预览验收**

在用户已经登录且明确允许测试的东南大学、复旦大学、中山大学报名页面中分别验证：

1. 打开普通字段页，记录点击“识别并预览”前后的字段值；确认值完全不变，popup 显示 Agent 计划来源。
2. 打开重复表格页，记录外层题干单元格 `getBoundingClientRect().top`、`height` 和 `getComputedStyle(...).verticalAlign`；标色后题干顶部不得向下漂移，清除标色后 inline 样式恢复原值。
3. 打开学术成果/奖励页，确认论文表只接受论文，项目表使用科研/项目，竞赛表使用竞赛，荣誉问题只使用荣誉；混合长文本允许按题干综合科研、论文、专利和竞赛。
4. 确认任何预览测试均不点击保存、下一步、确认、承诺、导师/志愿、验证码或最终提交。

Expected: 记录真实 DOM 测量与页面类型；若某站点无法安全自动遍历，只确认手动导航后的跨页收集，不绕过安全边界。

- [ ] **Step 6: 在真实页面验收连续填写的全局规划顺序**

使用临时可恢复字段或用户允许覆盖的测试字段：

1. 开始连续填写，确认历史先出现“正在收集页面”，期间字段值不变。
2. 收集结束后确认仅生成一个批次计划，计划中每页都有完整题干和对应 `pageKey`。
3. 执行阶段返回各页面并逐页回读；手工修改一个字段后切换页面再返回，修改值仍保留并标记人工值。
4. 关闭 popup、切换到另一标签再回来，批次状态、已收集页面、计划和历史仍存在。
5. 同时打开同一学校不同项目，确认 taskId、项目显示名和批次状态互不覆盖。
6. 到最终审核页自动停止，绝不执行最终提交。

Expected: 收集、规划、执行顺序可从 popup 历史和持久化 checkpoint 双重确认。

- [ ] **Step 7: 更新 release 验证记录并提交最终修复**

只有真实验证完成后，在 `docs/releases/v2.1.0.md` 的“验证”部分记录具体站点、页面类型、浏览器、构建版本和未验证边界；不得写入登录信息、URL 中的私密 token 或个人资料值。

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler add docs/releases/v2.1.0.md
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler commit -m "test: verify baotian agent 2.1.0"
```

- [ ] **Step 8: 最终自检 Git 和远程同步状态**

Run:

```powershell
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler status --short --branch
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler log --oneline -12
git -c safe.directory=C:/Users/Iron/Documents/Codex/2026-08-05/referenced-chatgpt-conversation-this-is-an/work/baoyan-auto-filler diff --check
```

Expected: `diff --check` 无输出，工作区仅保留用户原有且与本任务无关的改动。只有 `git push` 成功并通过远程 `main` commit SHA 核对后，才可以向用户说明 GitHub 已更新；只有 release 创建成功并重新读取验证后，才可以说明 release 已发布。

---

## Self-Review Record

### Spec coverage

- 单页预览使用完整 Agent 且零写入：Task 5。
- 连续填写先全页收集、再跨页规划、再执行：Tasks 2、3、6。
- 每页完整题干与结构进入模型：Tasks 1、3。
- 页面边界分块且不丢页面规则：Task 3。
- 学术成果、论文、项目、竞赛、荣誉严格分流：Task 4。
- 重复表格题干下沉和样式恢复：Task 7。
- 学校/院系/项目统一显示：Tasks 1、8。
- 删除三种填充策略：Task 8。
- 计划缓存和 API/Fast/资料/页面失效：Tasks 2、5、9。
- 多标签、多项目持久恢复和最终审核停止：Tasks 6、10。
- 版本 2.1.0、README、release、双浏览器构建、真实页面验收：Tasks 9、10。
- 安全过滤和绝不最终提交：Global Constraints、Tasks 3、6、10。

### Placeholder scan

- 所有任务均给出具体文件、接口、失败断言、运行命令、预期失败、最小实现边界、绿灯命令和提交命令。
- 未留下待定模块、未定义接口或省略测试步骤。

### Type consistency

- `AgentPageSnapshot` 是单页和批次唯一页面蓝图。
- `AgentPagePlan` 保持现有动作协议；`AgentBatchPlan.pagePlans` 只做外层按 `pageKey` 分组。
- `AgentBatchCheckpoint` 是任务持久状态；每页执行仍复用现有 `AgentCheckpoint`。
- `formatAgentApplicationDisplayName()` 是 popup、历史和统一审核唯一展示名来源。
- 页面计划和批次计划均通过页面、资料、API、Fast 和协议指纹失效。
