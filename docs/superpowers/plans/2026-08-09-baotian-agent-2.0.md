# 保填 Agent 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保填扩展内部实现受约束的页面填表 Agent，继续使用用户配置的中转 API，按当前页面实际结构完成整页和整行语义规划、执行、回读、修复、缓存和跨页恢复，并发布 `2.0.0`。

**Architecture:** 复用现有 DOM 扫描、资料库、本地匹配、写入、材料预览、任务和审核能力；新增 `utils/agent/`，将页面语义快照、候选资料检索、模型规划、策略校验、原子执行、回读验证、缓存和状态机拆成独立模块。模型只生成受约束的计划，扩展本地策略决定是否执行；连续填写控制器只调度 Agent，不再直接把字段匹配结果当成页面成功。

**Tech Stack:** TypeScript 5.9、WXT 0.20、Chrome/Edge Manifest V3、Firefox 构建、IndexedDB、`chrome.storage`、OpenAI-compatible Responses / Chat Completions、中转 API、Puppeteer 真实浏览器 QA。

## Global Constraints

- 版本号统一为 `2.0.0`；现有 `v1.5.0` 标签不移动，不发布 `v1.5.1` 或 `v1.6.0`。
- 使用用户配置的中转 API；本版本不加入 WebLLM、Chrome Prompt API 或其他本地模型。
- 不引入 Nanobrowser、Stagehand、Browser Use 或 Skyvern 作为运行时依赖；仅借鉴其公开架构。
- 模型不能直接执行 DOM 选择器、JavaScript 或任意点击；所有动作必须经过本地策略校验。
- 不自动最终提交、确认报名、选择导师/志愿、勾选承诺书、处理验证码、支付或删除报名记录。
- 不覆盖非空人工值；网页值与历史 Agent 值不同时视为人工修改。
- API Key、个人资料、登录状态、真实材料和模型原始响应不得进入 Git、Release、README 截图或普通日志。
- 所有生产逻辑必须先有失败测试并观察正确失败，再写最小实现。
- 真实报名系统允许扫描、填写、上传候选材料、预览和安全下一步；绝不最终提交。

---

## File Structure

新增文件：

```text
utils/agent/types.ts
utils/agent/page-snapshot.ts
utils/agent/profile-retriever.ts
utils/agent/planner-prompt.ts
utils/agent/planner-response.ts
utils/agent/planner.ts
utils/agent/policy.ts
utils/agent/executor.ts
utils/agent/verifier.ts
utils/agent/cache.ts
utils/agent/runtime.ts
scripts/test-agent-page-snapshot.ts
scripts/test-agent-profile-retriever.ts
scripts/test-agent-planner-response.ts
scripts/test-agent-policy.ts
scripts/test-agent-model-api.mjs
scripts/test-agent-execution.ts
scripts/test-agent-cache.ts
scripts/test-agent-runtime.ts
scripts/test-agent-ui.ts
docs/releases/v2.0.0.md
```

修改文件：

```text
utils/matcher.ts
utils/storage.ts
utils/db.ts
utils/page-analysis.ts
utils/application-tasks.ts
utils/repeatable-records.ts
entrypoints/content.ts
entrypoints/background.ts
entrypoints/popup/main.ts
entrypoints/popup/style.css
entrypoints/options/main.ts
package.json
package-lock.json
wxt.config.ts
README.md
README.en.md
```

---

### Task 1: 固化现有回归修复并建立 Agent 测试入口

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Verify existing: `entrypoints/content.ts`
- Verify existing: `utils/repeatable-records.ts`
- Verify existing: `scripts/test-repeatable-row-request.ts`

**Interfaces:**
- Consumes: 当前未提交的重复行批次上限和弹窗选择修复。
- Produces: 干净的 Agent 开发基线；`npm run test:agent:*` 测试命令；版本 `2.0.0`。

- [ ] **Step 1: 运行现有回归测试并记录基线**

Run:

```powershell
npm run test:repeatable-row-request
npm run test:repeatable-records
npm run test:repeatable-dialog
npm run test:dom-selection-policy
npm run compile
```

Expected: 全部退出码为 0；否则先按现有失败修复计划处理，不能开始 Agent 改造。

- [ ] **Step 2: 检查当前差异只包含已验证修复和版本文件**

Run:

```powershell
git diff -- entrypoints/content.ts utils/repeatable-records.ts scripts/test-repeatable-row-request.ts package.json package-lock.json
```

Expected: 重复行单次新增上限为 24、选择弹窗范围收紧、版本仍是尚未发布的 `1.5.1`。

- [ ] **Step 3: 将包版本修改为 2.0.0，并加入 Agent 测试脚本**

在 `package.json` 中设置：

```json
{
  "version": "2.0.0",
  "scripts": {
    "test:agent:snapshot": "tsx scripts/test-agent-page-snapshot.ts",
    "test:agent:profile": "tsx scripts/test-agent-profile-retriever.ts",
    "test:agent:response": "tsx scripts/test-agent-planner-response.ts",
    "test:agent:policy": "tsx scripts/test-agent-policy.ts",
    "test:agent:api": "tsx scripts/test-agent-model-api.mjs",
    "test:agent:execution": "tsx scripts/test-agent-execution.ts",
    "test:agent:cache": "tsx scripts/test-agent-cache.ts",
    "test:agent:runtime": "tsx scripts/test-agent-runtime.ts",
    "test:agent:ui": "tsx scripts/test-agent-ui.ts"
  }
}
```

同步 `package-lock.json` 根对象和包对象版本为 `2.0.0`。

- [ ] **Step 4: 构建并验证 manifest 版本**

Run:

```powershell
npm run build
(Get-Content .output/chrome-mv3/manifest.json -Raw | ConvertFrom-Json).version
```

Expected: 输出 `2.0.0`。

- [ ] **Step 5: 提交现有修复和版本基线**

```powershell
git add entrypoints/content.ts utils/repeatable-records.ts scripts/test-repeatable-row-request.ts package.json package-lock.json
git commit -m "fix: prepare repeat rows for agent workflows"
```

---

### Task 2: 定义 Agent 类型并生成页面语义快照

**Files:**
- Create: `utils/agent/types.ts`
- Create: `utils/agent/page-snapshot.ts`
- Create: `scripts/test-agent-page-snapshot.ts`
- Modify: `utils/matcher.ts`

**Interfaces:**
- Consumes: `FormFieldInfo`、页面 URL、页面标签、页面签名。
- Produces: `buildAgentPageSnapshot(input): AgentPageSnapshot`、`stableTargetId(pageKey, field): string`。

- [ ] **Step 1: 写页面分组失败测试**

测试使用 6 个字段：两行“时间、地点、内容”，要求：

```ts
const snapshot = buildAgentPageSnapshot({
  pageKey: 'fudan-awards',
  url: 'https://gsas.fudan.edu.cn/tm/example',
  title: '奖励情况（本科期间）',
  instructions: ['日期格式：2018-11', '内容中不得含有 |、#'],
  fields,
});

assert.equal(snapshot.groups.length, 1);
assert.equal(snapshot.groups[0].kind, 'repeatable');
assert.equal(snapshot.groups[0].rows.length, 2);
assert.deepEqual(snapshot.groups[0].columns.map((item) => item.label), ['时间', '地点', '内容']);
assert.deepEqual(snapshot.groups[0].rows[0].fields[2].forbiddenCharacters, ['|', '#']);
assert.equal(snapshot.groups[0].rows[0].fields[0].formatHints.includes('2018-11'), true);
assert.notEqual(snapshot.groups[0].rows[0].fields[0].targetId, snapshot.groups[0].rows[1].fields[0].targetId);
```

- [ ] **Step 2: 运行测试并观察失败**

Run: `npm run test:agent:snapshot`

Expected: FAIL，模块或 `buildAgentPageSnapshot` 不存在。

- [ ] **Step 3: 定义最小类型**

在 `types.ts` 中定义：

```ts
export type AgentGroupKind = 'single' | 'repeatable' | 'aggregate' | 'material';

export interface AgentTargetField {
  targetId: string;
  index: number;
  rowIndex?: number;
  columnId?: string;
  label: string;
  currentValue: string;
  required: boolean;
  protected: boolean;
  kind: 'text' | 'file';
  options: string[];
  placeholder: string;
  formatHints: string[];
  forbiddenCharacters: string[];
  maxLength?: number;
}

export interface AgentFieldRow {
  rowIndex: number;
  fields: AgentTargetField[];
}

export interface AgentFieldGroup {
  groupId: string;
  label: string;
  kind: AgentGroupKind;
  columns: Array<{ columnId: string; label: string }>;
  fields: AgentTargetField[];
  rows: AgentFieldRow[];
}

export interface AgentPageSnapshot {
  pageKey: string;
  url: string;
  title: string;
  stepText: string;
  instructions: string[];
  groups: AgentFieldGroup[];
  capturedAt: number;
}
```

- [ ] **Step 4: 实现稳定目标 ID 和分组**

`stableTargetId` 使用 `pageKey + repeatGroup/groupLabel + rowIndex + columnLabel + field fingerprint` 计算短哈希；`buildAgentPageSnapshot` 按 `repeatGroup/groupLabel` 和 `rowIndex` 聚合，规范化列名，合并 `dateFormat/hint/context/instructions` 中的格式和禁用字符。

- [ ] **Step 5: 增加人工值、maxlength 和普通字段测试**

断言普通字段进入 `single` 组；`value`、`required`、`protected`、`options`、`maxLength` 被完整保留。扩展 `FormFieldInfo`：

```ts
maxLength?: number;
forbiddenCharacters?: string[];
```

- [ ] **Step 6: 运行测试和编译**

Run:

```powershell
npm run test:agent:snapshot
npm run compile
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add utils/agent/types.ts utils/agent/page-snapshot.ts scripts/test-agent-page-snapshot.ts utils/matcher.ts package.json
git commit -m "feat: model pages as agent snapshots"
```

---

### Task 3: 根据页面语义检索候选资料记录

**Files:**
- Create: `utils/agent/profile-retriever.ts`
- Create: `scripts/test-agent-profile-retriever.ts`

**Interfaces:**
- Consumes: `AgentPageSnapshot`、`BlockCategory[]`、`TextField[]`。
- Produces: `retrieveAgentSourceRecords(snapshot, blocks, fields): AgentSourceRecord[]`。

- [ ] **Step 1: 写奖励页候选失败测试**

测试资料包含 `subject_competitions`、`honors_awards`、`education_career`、`family_members`。奖励页只应返回前两类：

```ts
const records = retrieveAgentSourceRecords(awardSnapshot, blocks, []);
assert.deepEqual([...new Set(records.map((record) => record.categoryId))], [
  'subject_competitions',
  'honors_awards',
]);
assert.equal(records[0].recordId, 'subject_competitions:0');
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:profile`

Expected: FAIL，函数不存在。

- [ ] **Step 3: 实现页面意图分类和记录序列化**

实现纯函数：

```ts
export type AgentPageIntent =
  | 'basic'
  | 'family'
  | 'education_career'
  | 'language'
  | 'project'
  | 'publication'
  | 'patent'
  | 'award'
  | 'material'
  | 'unknown';

export function inferAgentPageIntent(snapshot: AgentPageSnapshot): AgentPageIntent;
export function retrieveAgentSourceRecords(
  snapshot: AgentPageSnapshot,
  blocks: BlockCategory[],
  fields: TextField[],
): AgentSourceRecord[];
```

采用页面标题、组标题和列名共同判断；单个“工作”字样不能把履历表识别为项目页。每条 `BlockItem` 转换为稳定 `recordId` 和非空字段对象。

- [ ] **Step 4: 写履历隔离和整段项目测试**

断言“起始时间、结束时间、学校或工作单位、担任职务”只返回 `education_career`；“项目名称、描述、时间段、本人角色”返回科研训练、实习实践、社会工作。

- [ ] **Step 5: 运行测试**

Run:

```powershell
npm run test:agent:profile
npm run test:profile-projections
npm run test:local-matcher
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add utils/agent/profile-retriever.ts scripts/test-agent-profile-retriever.ts
git commit -m "feat: retrieve profile records for page agents"
```

---

### Task 4: 解析和校验模型页面计划

**Files:**
- Extend: `utils/agent/types.ts`
- Create: `utils/agent/planner-response.ts`
- Create: `scripts/test-agent-planner-response.ts`

**Interfaces:**
- Consumes: 模型文本、`AgentPageSnapshot`、`AgentSourceRecord[]`。
- Produces: `parseAgentPagePlan(text, context): AgentPagePlan`；错误时抛出 `AgentPlanValidationError`。

- [ ] **Step 1: 写复旦整行计划失败测试**

输入模型 JSON 包含一条 `fill_row`，三个值分别对应时间、地点、内容。断言：

```ts
assert.equal(plan.actions[0].type, 'fill_row');
assert.equal(plan.actions[0].sourceRecordId, 'subject_competitions:0');
assert.equal(plan.actions[0].values.length, 3);
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:response`

Expected: FAIL，解析器不存在。

- [ ] **Step 3: 定义计划类型和严格解析器**

支持动作：

```ts
export type AgentPlannedAction =
  | AgentAddRowsAction
  | AgentFillFieldAction
  | AgentFillRowAction
  | AgentSelectAction
  | AgentUploadAction;
```

解析器必须拒绝未知顶级字段、未知动作类型、空 `actionId`、重复 `actionId`、不存在的 `targetId`、不存在的 `sourceRecordId`、跨组目标和非有限置信度。

- [ ] **Step 4: 写恶意/错误响应测试**

分别断言拒绝：

```text
虚构 sourceRecordId
虚构 targetId
evidenceFields 不存在
同一 fill_row 跨两个 rowIndex
同一 targetId 出现两次
模型返回 submit 或 click 动作
模型返回 Markdown 代码围栏包裹 JSON
```

代码围栏允许剥离后解析；不安全动作必须拒绝。

- [ ] **Step 5: 运行测试和编译**

Run:

```powershell
npm run test:agent:response
npm run compile
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add utils/agent/types.ts utils/agent/planner-response.ts scripts/test-agent-planner-response.ts
git commit -m "feat: validate structured agent plans"
```

---

### Task 5: 实现本地策略引擎和完整性门禁

**Files:**
- Create: `utils/agent/policy.ts`
- Create: `scripts/test-agent-policy.ts`

**Interfaces:**
- Consumes: `AgentPagePlan`、页面快照、资料记录、历史 Agent 值、当前网页值。
- Produces: `validateAgentPlan(...)`、`deriveAgentRowStatus(...)`、`canAgentAdvance(...)`。

- [ ] **Step 1: 写部分行失败测试**

复旦一行只有“时间”有计划、地点和内容为空：

```ts
const status = deriveAgentRowStatus(row, plannedValues, observedValues);
assert.equal(status.status, 'partial');
assert.equal(status.marker, 'review');
assert.equal(status.blocksAdvance, true);
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:policy`

Expected: FAIL，策略函数不存在。

- [ ] **Step 3: 实现计划策略**

`validateAgentPlan` 执行：

```text
目标存在性
行和组归属
sourceRecordId 绑定
evidenceFields 存在
禁止字符去除后再验证
maxlength
日期格式
非空人工值保护
高风险动作拒绝
```

没有证据的值不自动执行，转为 `reviewItems`。

- [ ] **Step 4: 写人工值和导航安全测试**

断言：

```text
当前网页非空且不同于 lastAgentValue → manual，禁止覆盖
“最终提交”“确认报名”“承诺书”“选择导师” → canAgentAdvance=false
必填字段空 → false
partial row → false
全部 verified/manual 且按钮是“下一步” → true
```

- [ ] **Step 5: 运行测试**

Run:

```powershell
npm run test:agent:policy
npm run test:page-analysis-recovery
npm run test:tasks
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add utils/agent/policy.ts scripts/test-agent-policy.ts
git commit -m "feat: enforce safe agent plan policies"
```

---

### Task 6: 增加中转 API 的页面规划调用和兼容回退

**Files:**
- Create: `utils/agent/planner-prompt.ts`
- Create: `utils/agent/planner.ts`
- Create: `scripts/test-agent-model-api.mjs`
- Modify: `utils/matcher.ts`

**Interfaces:**
- Consumes: `AgentPageSnapshot`、`AgentSourceRecord[]`、`ApiConfig`。
- Produces: `requestAgentPagePlan(input, config): Promise<AgentPagePlan>`；复用 `requestModelText` 和请求 URL/响应提取。

- [ ] **Step 1: 写请求体失败测试**

Responses 模式断言请求体包含：

```js
assert.equal(body.model, 'gpt-5.6');
assert.equal(body.store, false);
assert.equal(body.service_tier, 'fast');
assert.equal(body.text.format.type, 'json_schema');
assert.equal(body.text.format.name, 'baotian_page_plan');
assert.equal(body.text.format.strict, true);
```

Chat 模式断言使用 `messages` 和 `response_format`；Fast 模式只在后端支持的既有位置发送。

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:api`

Expected: FAIL，Agent 请求体构造器不存在。

- [ ] **Step 3: 抽取通用模型请求适配器**

从 `matcher.ts` 导出或移动以下可复用能力，保持现有调用行为：

```ts
export function getRequestUrl(apiConfig: ApiConfig): string;
export function getRequestBody(apiConfig: ApiConfig, prompt: string, options?: ModelRequestOptions): unknown;
export async function requestModelText(apiConfig: ApiConfig, prompt: string, options?: ModelRequestOptions): Promise<string>;
```

`ModelRequestOptions` 支持 `jsonSchema`，不改变普通字段和长问题默认请求体。

- [ ] **Step 4: 实现页面规划提示词**

提示词必须包含：

```text
页面标题、步骤和说明
组、行、列、targetId、当前值、必填、格式和选项
候选记录 recordId、类别和字段
允许动作 JSON Schema
同一行同一记录约束
证据字段要求
禁止提交和无证据生成
```

不包含 API Key、cookie、密码字段、验证码和完整无关 DOM。

- [ ] **Step 5: 写不支持结构化输出的回退测试**

模拟第一次返回 HTTP 400 且错误明确包含 `response_format`、`text.format`、`json_schema` 或 `unsupported parameter`；断言只回退一次普通 JSON。HTTP 401、403、429、502 和网络错误不回退为其他 API 模式，直接返回标准化错误。

- [ ] **Step 6: 运行 API 测试和既有 LLM 测试**

Run:

```powershell
npm run test:agent:api
npm run test:llm-api
npm run test:long-question
npm run compile
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add utils/agent/planner-prompt.ts utils/agent/planner.ts scripts/test-agent-model-api.mjs utils/matcher.ts
git commit -m "feat: plan form pages through relay APIs"
```

---

### Task 7: 转换计划为原子动作并回读验证

**Files:**
- Create: `utils/agent/executor.ts`
- Create: `utils/agent/verifier.ts`
- Create: `scripts/test-agent-execution.ts`
- Modify: `entrypoints/content.ts`

**Interfaces:**
- Consumes: 已批准 `AgentPagePlan`、当前页面快照。
- Produces: `buildAgentExecutionBatch(plan, snapshot)`、`verifyAgentExecution(plan, before, after)`；content message `executeAgentActions`。

- [ ] **Step 1: 写整行执行批次失败测试**

断言 `fill_row` 被转换为三个具有相同 `actionId/sourceRecordId/rowIndex` 的 `fill` 原子动作，顺序按页面列顺序，而不是模型数组顺序。

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:execution`

Expected: FAIL，执行器不存在。

- [ ] **Step 3: 实现执行批次**

```ts
export interface AgentExecutionItem {
  actionId: string;
  targetId: string;
  index: number;
  value: string;
  confidence: 'high' | 'medium';
}
```

执行前根据最新扫描重新解析 `targetId → index`；目标不存在或页面签名变化时不执行。

- [ ] **Step 4: 在 content script 中加入稳定目标执行消息**

新增消息：

```ts
{
  type: 'executeAgentActions',
  pageKey: string,
  items: AgentExecutionItem[]
}
```

每项继续调用现有 `fillElementAsync`，但返回：

```ts
{
  actionId: string;
  targetId: string;
  attempted: boolean;
  observed: string;
  matched: boolean;
  reason: string;
}
```

- [ ] **Step 5: 写回读状态测试**

覆盖：全部一致 `verified`；只时间一致 `partial`；人工值改变 `manual`；写入后为空 `failed`；页面目标消失 `failed/retryable`。

- [ ] **Step 6: 运行测试和 DOM 策略测试**

Run:

```powershell
npm run test:agent:execution
npm run test:dom-selection-policy
npm run compile
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add utils/agent/executor.ts utils/agent/verifier.ts scripts/test-agent-execution.ts entrypoints/content.ts
git commit -m "feat: execute and verify agent form plans"
```

---

### Task 8: 持久化计划缓存和 Agent 检查点

**Files:**
- Create: `utils/agent/cache.ts`
- Create: `scripts/test-agent-cache.ts`
- Modify: `utils/db.ts`
- Modify: `utils/page-analysis.ts`
- Modify: `utils/application-tasks.ts`

**Interfaces:**
- Consumes: 页面快照、资料记录、API 配置、计划、动作结果。
- Produces: `createAgentPlanCacheKey`、`getAgentPlanCache`、`saveAgentPlanCache`、`updateAgentCheckpoint`。

- [ ] **Step 1: 写缓存指纹失败测试**

断言相同页面/资料/模型配置命中；字段、资料、模型、API 模式、Fast 模式或协议版本变化时失效；API Key 变化不改变缓存键，且缓存序列化不包含 API Key。

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:cache`

Expected: FAIL，缓存函数不存在。

- [ ] **Step 3: 实现缓存记录**

新增 IndexedDB store `agentPlans`，记录：

```ts
interface AgentPlanCacheRecord {
  key: string;
  pageKey: string;
  plan: AgentPagePlan;
  createdAt: number;
  updatedAt: number;
}
```

数据库版本升级必须保留现有资料、文件和任务 stores。

- [ ] **Step 4: 扩展任务检查点**

`ApplicationRunnerCheckpoint` 增加可选：

```ts
agent?: AgentCheckpoint;
```

克隆、合并、导出工作台数据时深拷贝该字段。每次动作后更新 `nextActionIndex/results/retries/manualOverrides/updatedAt`。

- [ ] **Step 5: 写休眠恢复测试**

序列化检查点、丢弃所有内存变量、反序列化后断言从未完成动作继续；已经 verified/manual 的动作不重复执行。

- [ ] **Step 6: 运行测试**

Run:

```powershell
npm run test:agent:cache
npm run test:tasks
npm run test:page-analysis-recovery
npm run compile
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add utils/agent/cache.ts scripts/test-agent-cache.ts utils/db.ts utils/page-analysis.ts utils/application-tasks.ts
git commit -m "feat: persist agent plans and checkpoints"
```

---

### Task 9: 实现 observe-plan-execute-verify-repair 状态机

**Files:**
- Create: `utils/agent/runtime.ts`
- Create: `scripts/test-agent-runtime.ts`
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: 注入的 observe、retrieve、plan、validate、prepare、execute、verify、save、advance 适配器。
- Produces: `runAgentPage(deps, checkpoint): Promise<AgentRunOutcome>`。

- [ ] **Step 1: 写完整状态迁移失败测试**

使用真实纯函数适配器和受控内存仓库，断言：

```text
observing → planning → validating → executing → verifying → complete
每阶段保存检查点
verified action 不重放
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:runtime`

Expected: FAIL，运行时不存在。

- [ ] **Step 3: 实现可注入状态机**

```ts
export interface AgentRuntimeDeps {
  observe(): Promise<AgentPageSnapshot>;
  retrieve(snapshot: AgentPageSnapshot): Promise<AgentSourceRecord[]>;
  plan(snapshot: AgentPageSnapshot, records: AgentSourceRecord[]): Promise<AgentPagePlan>;
  validate(plan: AgentPagePlan, snapshot: AgentPageSnapshot, records: AgentSourceRecord[]): AgentValidatedPlan;
  execute(plan: AgentValidatedPlan): Promise<AgentExecutionReport>;
  verify(plan: AgentValidatedPlan): Promise<AgentVerificationReport>;
  save(checkpoint: AgentCheckpoint): Promise<void>;
}
```

每阶段只执行一次职责，并在下一阶段前保存检查点。

- [ ] **Step 4: 写有限修复和 API 失败测试**

断言：partial/failed 动作最多修复两次；第三次进入 paused；502 使复杂动作进入 paused，但本地 verified 结果保留；页面签名变化使旧计划失效并重新观察。

- [ ] **Step 5: 接入 background 调度**

`collectTabScan` 继续生成本地结果和材料候选；复杂重复组和低完整度组进入 Agent planner。`processAutoRun` 只负责：

```text
加载任务
调用 runAgentPage
同步历史/UI
根据 outcome 暂停、恢复或安全下一步
```

删除“匹配数量等于成功数量”的隐含假设。

- [ ] **Step 6: 运行状态、任务和自动化测试**

Run:

```powershell
npm run test:agent:runtime
npm run test:tasks
npm run test:page-analysis-recovery
npm run test:repeatable-records
npm run compile
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add utils/agent/runtime.ts scripts/test-agent-runtime.ts entrypoints/background.ts
git commit -m "feat: orchestrate persistent form filling agents"
```

---

### Task 10: 采集页面填写规则和受控输入兼容性

**Files:**
- Modify: `entrypoints/content.ts`
- Extend: `scripts/test-agent-page-snapshot.ts`
- Extend: `scripts/test-agent-execution.ts`

**Interfaces:**
- Consumes: 真实 DOM。
- Produces: 包含格式、限制、行列和当前校验状态的 `FormFieldInfo`；可靠的受控输入回读。

- [ ] **Step 1: 写复旦规则提取失败测试**

构造 DOM：

```html
<h3>奖励情况（本科期间）</h3>
<div>时间（日期格式：2018-11）</div>
<div>地点</div>
<div>内容</div>
<div>内容中不得含有 |、#</div>
```

断言扫描字段携带日期格式和禁用字符，三列具有相同 repeatGroup 和正确 rowIndex。

- [ ] **Step 2: 运行并观察失败**

Run:

```powershell
npm run test:agent:snapshot
npm run test:agent:execution
```

Expected: 至少一项因缺少规则或行列关系失败。

- [ ] **Step 3: 实现最近语义范围采集**

仅从字段所属表格、fieldset、最近标题和说明区域提取规则；禁止读取整页祖先文本造成跨组污染。采集 `maxlength`、`pattern`、日期提示、禁用字符、必填标记和当前校验提示。

- [ ] **Step 4: 增加受控输入的条件等待**

写入后按目标值或网页规范化值轮询，不使用固定短等待作为成功依据；超时返回 observed value 和原因。对 React/Vue 输入使用原生 setter + `input/change/blur`，并保护页面人工值。

- [ ] **Step 5: 运行 DOM、选择器和既有本地匹配测试**

Run:

```powershell
npm run test:agent:snapshot
npm run test:agent:execution
npm run test:dom-selection-policy
npm run test:local-matcher
npm run compile
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add entrypoints/content.ts scripts/test-agent-page-snapshot.ts scripts/test-agent-execution.ts
git commit -m "feat: observe page rules for agent filling"
```

---

### Task 11: 在工作台展示 Agent 计划、执行和暂停原因

**Files:**
- Create: `scripts/test-agent-ui.ts`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/popup/style.css`
- Modify: `entrypoints/options/main.ts`

**Interfaces:**
- Consumes: 页面分析和 `AgentCheckpoint` 摘要。
- Produces: 当前网站优先的 Agent 状态 UI、页面计划详情和受控重试操作。

- [ ] **Step 1: 写视图模型失败测试**

给定包含 verified/manual/review/failed 的检查点，断言视图模型输出：

```ts
assert.deepEqual(summary, {
  phaseLabel: '等待确认',
  verified: 12,
  manual: 1,
  review: 2,
  failed: 1,
  cached: true,
  retries: 2,
});
```

- [ ] **Step 2: 运行并观察失败**

Run: `npm run test:agent:ui`

Expected: FAIL，Agent 视图模型不存在。

- [ ] **Step 3: 实现页面记录 UI**

每页展示：

```text
页面名称
观察/规划/校验/执行/回读/修复/暂停阶段
本地计划数和 AI 计划数
缓存状态
已验证/人工修改/待确认/冲突/失败
重复行完成度
API 错误
暂停原因
```

操作只包含：查看本页计划、定位字段、重试失败项、接受人工修改、重新规划本页、停止任务。

- [ ] **Step 4: 增加敏感信息脱敏测试**

断言工作台 HTML 和日志摘要不包含 API Key、身份证号完整值、密码字段、模型原始响应和文件二进制。

- [ ] **Step 5: 运行 UI 和审核测试**

Run:

```powershell
npm run test:agent:ui
npm run test:audit-view-model
npm run test:audit
npm run compile
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add scripts/test-agent-ui.ts entrypoints/popup/main.ts entrypoints/popup/style.css entrypoints/options/main.ts
git commit -m "feat: surface agent plans and verification"
```

---

### Task 12: 复旦真实页面回归和跨系统安全验收

**Files:**
- Modify only after failing reproduction: relevant `scripts/test-agent-*.ts` and production module
- Create sanitized QA artifacts only under ignored `qa/`

**Interfaces:**
- Consumes: `.output/chrome-mv3`、独立 Edge QA 配置、已登录真实页面。
- Produces: 真实扫描/填写/回读证据和新的自动化回归测试。

- [ ] **Step 1: 重新构建并加载 2.0.0 QA 扩展**

Run:

```powershell
npm run build
(Get-Content .output/chrome-mv3/manifest.json -Raw | ConvertFrom-Json) | Select-Object name,version
```

Expected: `保填`、`2.0.0`。

- [ ] **Step 2: 在复旦奖励页先扫描、不填写，核对计划**

核对：

```text
页面识别为奖励重复表格
17 条来源记录分别绑定到 17 行
每行具有时间、地点、内容计划或明确 review
没有跨记录拼接
内容不包含 |、#
没有提交动作
```

- [ ] **Step 3: 执行奖励页填写并回读**

允许覆盖此前 Agent 写入的错误测试值，但不得覆盖用户手工确认值。验证：只填时间的行状态为 partial，完整行才为 verified；存在 review/failed 时不自动下一步。

- [ ] **Step 4: 验证学习和工作经历**

页面只能使用：

```text
2020-09 → 2023-06，山东省临朐中学，安全信息员
2023-09 → 2027-06，合肥工业大学，学习委员、曾任心协宣传培训部部长
```

不得混入科研训练、实习实践、社会工作、学科竞赛或奖励。

- [ ] **Step 5: 验证连续填写和返回页面**

运行到最终审核前或安全阻塞项：关闭侧边栏、切换标签页、返回旧页面，核对检查点、缓存、标色和人工修改仍存在。不得最终提交。

- [ ] **Step 6: 将每个真实问题转成失败测试后修复**

对发现的问题执行：写最小失败测试 → 观察正确失败 → 修改生产代码 → 运行通过 → 重新真实验证。禁止只在页面上临时调试后直接改生产逻辑。

- [ ] **Step 7: 运行完整 Agent 和既有回归集**

Run:

```powershell
npm run test:agent:snapshot
npm run test:agent:profile
npm run test:agent:response
npm run test:agent:policy
npm run test:agent:api
npm run test:agent:execution
npm run test:agent:cache
npm run test:agent:runtime
npm run test:agent:ui
npm run test:profile
npm run test:profile-projections
npm run test:long-question
npm run test:local-matcher
npm run test:repeatable-records
npm run test:repeatable-row-request
npm run test:repeatable-dialog
npm run test:dom-selection-policy
npm run test:tasks
npm run test:page-analysis-recovery
npm run test:audit
npm run test:ai-queue
npm run test:material-audit
npm run test:audit-view-model
npm run test:page-identity
npm run test:llm-api
npm run compile
```

Expected: 全部退出码为 0。

- [ ] **Step 8: 提交真实回归修复**

```powershell
git add scripts utils entrypoints
git commit -m "fix: harden agent flows on real applications"
```

---

### Task 13: README、脱敏截图、双浏览器构建和 2.0.0 Release

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Replace: `assets/1-popup.png`
- Replace: `assets/2-filling.png`
- Replace: `assets/3-page.png`
- Create: `docs/releases/v2.0.0.md`

**Interfaces:**
- Consumes: 已验证的 Agent UI、测试结果和真实能力边界。
- Produces: 产品主页型 README、脱敏截图、Chrome/Edge 和 Firefox 安装包、正式 GitHub Release。

- [ ] **Step 1: 使用虚构资料生成脱敏产品截图**

截图只能使用虚构姓名、虚构联系方式、虚构报名页面和虚构材料文件名；不得包含真实登录 URL 参数、API Key、身份证号、电话、地址或材料内容。

- [ ] **Step 2: 重写中英文 README 的 Agent 部分**

README 必须解释：

```text
保填 Agent 的 observe-plan-execute-verify-repair
中转 API 是可替换推理后端
普通字段的本地降级
复杂重复表格和长问题的动态投影
页面缓存、人工修改保护和多网站任务
材料匹配、预览和最终审核
永不自动最终提交的安全边界
Edge 解压扩展更新方式
```

- [ ] **Step 3: 编写 Release notes**

`docs/releases/v2.0.0.md` 包含主要功能、从 1.x 升级方式、数据备份提示、已知限制、隐私说明、安装包校验信息和真实系统验收范围，不包含个人数据。

- [ ] **Step 4: 运行完整测试、审计和双浏览器构建**

Run:

```powershell
npm run compile
npm run build
npm run build:firefox
npm audit
npm run zip
npm run zip:firefox
```

Expected: 编译和构建退出码为 0；审计结果无未说明的高危问题；生成 Chrome 和 Firefox 压缩包。

- [ ] **Step 5: 检查安装包 manifest 和敏感信息**

解压到临时目录并断言两个 manifest 版本均为 `2.0.0`；搜索 `sk-`、真实姓名、手机号、身份证号、真实材料名和 QA 登录 URL，结果为空。

- [ ] **Step 6: 提交发布内容**

```powershell
git add README.md README.en.md assets docs/releases/v2.0.0.md package.json package-lock.json wxt.config.ts
git commit -m "docs: launch Baotian Agent 2.0"
```

- [ ] **Step 7: 推送并创建正式 Release**

```powershell
git push origin main
git tag -a v2.0.0 -m "保填 Agent 2.0.0"
git push origin v2.0.0
gh release create v2.0.0 .output/baotian-2.0.0-chrome.zip .output/baotian-2.0.0-firefox.zip --repo ironhxs/baoyan-auto-filler --title "保填 Agent v2.0.0" --notes-file docs/releases/v2.0.0.md
```

- [ ] **Step 8: 回验 GitHub 和用户正常 Edge 扩展**

读取公开 Release、附件和 README；备份用户当前解压扩展目录后覆盖 Chrome 构建，读取目标目录 manifest 验证 `2.0.0`，再让用户在 `edge://extensions` 点击“重新加载”。

---

## Self-Review

- 规格中的页面观察、候选检索、整行投影、证据约束、策略校验、执行回读、修复循环、缓存、检查点、多站点、安全和发布要求均有对应任务。
- 计划没有使用 `TBD`、`TODO`、“类似前一任务”或无具体断言的测试步骤。
- `AgentPageSnapshot`、`AgentSourceRecord`、`AgentPagePlan`、`AgentCheckpoint`、`AgentActionResult` 在前序任务定义，后续任务名称一致。
- 每个生产模块先有明确失败测试和预期失败，再实现并运行回归。
- 真实 QA 和发布在核心自动化测试之后，并继续禁止最终提交。
- 本地模型被明确排除；所有 Agent 规划继续使用用户中转 API。
