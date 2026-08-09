# 保填 Agent 设计规格

## 1. 背景

保填当前已经具备资料管理、页面字段扫描、本地字段匹配、可选 AI 增强、重复行准备、普通字段写入、材料匹配与预览、连续填写、任务记录、页面缓存和最终检查等能力。现有 AI 匹配仍以“一个网页字段对应一个资料字段”为主要抽象，无法可靠处理以下跨网站结构转换：

- 一条学科竞赛记录转换为“时间、地点、内容”一整行；
- 一条科研训练记录转换为“项目名称、项目描述、项目时间段、本人角色”；
- 多个结构化字段合成为一个长文本框；
- 一个综合字段拆分为多个目标列；
- 同一类资料在不同学校中使用完全不同的字段顺序和命名；
- 只有部分列成功填写时识别为“整行未完成”，而不是误判为页面成功。

复旦真实页面暴露了该问题：奖励表格包含“时间、地点、内容”三列，当前逻辑只把获奖时间写入第一列，却把这些结果当成已匹配和已填写。根因不是单个学校的 DOM 特例，而是现有匹配模型缺少页面级规划、记录级投影、证据约束和整行完整性门禁。

本设计引入运行在扩展内部的受约束填表智能体“保填 Agent”。用户配置的中转 API 继续作为推理后端；本版本不集成本地模型，不依赖 Codex 产品，不绑定单一模型供应商。

## 2. 目标

版本目标为 `1.6.0`。

保填 Agent 必须：

1. 读取当前页面实际存在的标题、说明、字段、表格、格式提示、限制和现有值；
2. 根据页面语义选择最相关的本地资料记录；
3. 以“整页、整组、整行”为规划单位，允许多源字段组合为一个目标值，以及一条记录拆分为多个目标值；
4. 为每个生成值保留来源记录和证据字段；
5. 在浏览器本地验证计划后，才允许执行原子填写动作；
6. 写入后重新扫描页面并逐项回读，不以“执行过赋值”代替成功；
7. 仅对失败的字段或行进行有限次数的修复规划；
8. 保存页面计划、执行检查点、人工修改和验证结果，支持页面切换、扩展后台休眠、多个标签页和多个报名项目；
9. 同一页面结构和资料快照不变时复用计划，不重复调用 API；
10. 无法确定、资料缺失或回读失败时明确暂停，不编造事实、不伪装成功；
11. 永远不执行最终提交、确认报名、选择导师、勾选承诺书、验证码、支付或删除报名数据。

## 3. 非目标

本版本不实现：

- WebLLM、Chrome Prompt API 或其他浏览器本地模型；
- 自动解析 Word/PDF 个人资料并写入七类资料库；
- 验证码识别或绕过；
- 最终提交或报名确认；
- 自动选择导师、志愿、研究方向或承诺书；
- 为单个学校写不可复用的硬编码填写方案；
- 允许模型直接执行任意 CSS 选择器、任意 JavaScript 或任意点击；
- 无证据的事实补全。

## 4. 核心原则

### 4.1 智能规划，确定执行

模型负责页面语义理解、资料选择和填写计划；扩展负责目标定位、格式校验、权限控制、写入、回读和导航。模型不直接获得浏览器控制权。

### 4.2 记录级投影

重复表格的最小语义单位是一条记录，不是一个输入框。计划中的同一行只能绑定一个明确的 `sourceRecordId`；允许该记录的多个字段共同支持一个目标值，但禁止跨记录拼接。

### 4.3 证据约束

每个模型生成值必须声明 `evidenceFields`。本地策略引擎验证字段存在于绑定记录中。允许语序调整、格式转换、去除禁用字符和基于原文的摘要，不允许生成原始资料无法支持的成绩、级别、时间、排名、角色、论文状态或地点。

### 4.4 不完整不成功

重复行只有在所有可自动确定的必填列完成回读，且不能自动确定的列已显式进入 `needsReview` 状态时，才算处理结束。任何只填部分列的行不得标记为绿色整行，不得触发自动下一步。

### 4.5 人工修改优先

非空字段默认不覆盖。缓存计划重新载入时，如果网页当前值与上次 Agent 写入值不同，则视为人工修改；该值进入 `manualOverride`，后续计划不得覆盖，除非用户在界面中明确选择重新填写。

### 4.6 安全导航

Agent 只可请求 `advance`。本地策略引擎在确认当前页没有阻塞项、按钮语义为安全的“下一步/保存并下一步”、且不是最终提交类动作时才执行。所有最终提交类页面均停在人工审核状态。

## 5. 系统架构

新增 `utils/agent/` 目录，按职责拆分：

```text
utils/agent/
  types.ts              Agent 输入、计划、动作、验证和检查点类型
  page-snapshot.ts      将现有 FormFieldInfo 聚合为页面/组/行语义快照
  profile-retriever.ts  根据页面语义筛选并序列化候选资料记录
  planner-prompt.ts     构造页面规划和局部修复提示词
  planner-response.ts   解析、规范化并校验模型 JSON
  planner.ts            调用现有中转 API，处理结构化输出和兼容回退
  policy.ts             证据、行归属、格式、覆盖和动作安全校验
  executor.ts           将已批准计划转换为现有 content-script 原子命令
  verifier.ts           将执行后扫描结果与计划对比，生成验证报告
  cache.ts              页面计划指纹和持久化缓存
  runtime.ts            observe-plan-validate-execute-verify-repair 状态机
```

现有模块职责调整：

- `entrypoints/content.ts`：继续负责 DOM 扫描与具体写入；增加页面约束采集、按稳定目标引用执行和动作后回读；不承担模型规划。
- `entrypoints/background.ts`：保留消息路由和标签页调度；将 Agent 循环从 `processAutoRun` 中下沉到 `utils/agent/runtime.ts`。
- `utils/matcher.ts`：保留普通字段 AI 匹配和长问题能力；抽取通用模型请求适配器供 Agent 规划器复用。
- `utils/local-matcher.ts`：继续作为无 API、API 失败和明确普通字段的高置信降级路径。
- `utils/application-tasks.ts`：扩展持久化的 Agent 检查点、计划摘要和人工覆盖信息。
- `utils/page-analysis.ts`：保存计划、执行、验证和暂停原因，支持返回旧页面恢复。
- `utils/repeatable-records.ts`：继续准备可见行；目标行数由经过策略校验的 Agent 页面计划确定。

## 6. 数据模型

### 6.1 页面快照

```ts
interface AgentPageSnapshot {
  pageKey: string;
  url: string;
  title: string;
  stepText: string;
  instructions: string[];
  groups: AgentFieldGroup[];
  actions: AgentPageActionHint[];
  capturedAt: number;
}

interface AgentFieldGroup {
  groupId: string;
  label: string;
  kind: 'single' | 'repeatable' | 'aggregate' | 'material';
  fields: AgentTargetField[];
  rowCount?: number;
  addRowAvailable?: boolean;
}

interface AgentTargetField {
  targetId: string;
  index: number;
  rowIndex?: number;
  columnId?: string;
  label: string;
  currentValue: string;
  required: boolean;
  protected: boolean;
  kind: FormFieldInfo['kind'];
  options: string[];
  placeholder: string;
  formatHints: string[];
  forbiddenCharacters: string[];
  maxLength?: number;
}
```

`targetId` 必须由页面身份、组、行、列和现有字段指纹稳定生成，不能仅使用本次扫描的数组下标。

### 6.2 候选资料

```ts
interface AgentSourceRecord {
  recordId: string;
  categoryId: string;
  categoryLabel: string;
  fields: Record<string, string>;
}
```

资料检索器只返回与页面语义兼容的记录。允许的主要投影关系：

- 奖励表格：`subject_competitions`、`honors_awards`，以及明确含获奖结果且页面语义允许的实践/项目记录；
- 项目经历：`research_training`、`internship_practice`、`social_work`；
- 学习与工作履历：仅 `education_career`；
- 家庭成员：仅 `family_members`；
- 外语水平：仅 `language_skills`；
- 论文：仅 `published_papers`；
- 专利：仅 `granted_patents`。

投影关系是候选范围，不是固定字段映射。具体目标值由当前页面结构决定。

### 6.3 页面计划

```ts
interface AgentPagePlan {
  version: 1;
  pageKey: string;
  snapshotFingerprint: string;
  profileFingerprint: string;
  actions: AgentPlannedAction[];
  reviewItems: AgentReviewItem[];
}

type AgentPlannedAction =
  | AgentAddRowsAction
  | AgentFillFieldAction
  | AgentFillRowAction
  | AgentSelectAction
  | AgentUploadAction;
```

`AgentFillRowAction` 必须包含：

```ts
interface AgentFillRowAction {
  actionId: string;
  type: 'fill_row';
  groupId: string;
  rowIndex: number;
  sourceRecordId: string;
  values: Array<{
    targetId: string;
    value: string;
    evidenceFields: string[];
    confidence: number;
    needsReview: boolean;
    reason: string;
  }>;
}
```

### 6.4 执行与验证

```ts
interface AgentActionResult {
  actionId: string;
  status: 'verified' | 'partial' | 'failed' | 'skipped' | 'review';
  fields: Array<{
    targetId: string;
    expected: string;
    observed: string;
    status: 'verified' | 'mismatch' | 'missing' | 'manual';
  }>;
  retryable: boolean;
  message: string;
}
```

### 6.5 检查点

```ts
interface AgentCheckpoint {
  taskId: string;
  tabId: number;
  pageKey: string;
  phase: 'observing' | 'planning' | 'validating' | 'executing' | 'verifying' | 'repairing' | 'paused' | 'complete';
  plan?: AgentPagePlan;
  nextActionIndex: number;
  results: AgentActionResult[];
  retries: Record<string, number>;
  manualOverrides: Record<string, string>;
  updatedAt: number;
}
```

每个原子动作和每次页面导航前后都保存检查点。不得依赖 Manifest V3 service worker 的全局变量维持任务状态。

## 7. 模型接口

### 7.1 中转 API

继续复用当前设置：

- Base URL；
- API Key；
- 模型名称；
- `responses` 或 `chat_completions`；
- Fast 模式；
- OpenAI 兼容的自定义 provider。

不增加本地模型依赖。

### 7.2 结构化输出

Responses 模式优先请求 JSON Schema 结构化输出。若中转明确返回“不支持该参数”的 4xx 错误，则对同一请求回退一次为普通 JSON 指令，并使用本地严格解析器校验。502、网络错误或模型错误不回退为另一种业务逻辑，保留本地匹配结果并暂停需要 AI 的部分。

Chat Completions 模式在中转支持时使用 `response_format` JSON Schema；不支持时使用普通 JSON 指令和相同本地校验。

模型原始响应不得直接成为 `MatchResult`。必须先经过：

```text
解析
→ 类型校验
→ 目标存在性校验
→ 资料来源校验
→ 证据校验
→ 行归属校验
→ 格式与字符校验
→ 覆盖策略校验
→ 安全动作校验
```

### 7.3 缓存指纹

计划缓存键包含：

```text
页面语义快照指纹
候选资料指纹
Base URL
模型名称
API 模式
Fast 模式
Agent 计划协议版本
```

不得包含 API Key。当前页 DOM、资料或模型配置任一变化时重新规划。

## 8. Agent 循环

```text
OBSERVE
  扫描页面并生成语义快照

RETRIEVE
  筛选页面可用的资料记录

PLAN
  普通明确字段采用本地计划
  复杂组、低完整度重复行和长问题调用模型规划

VALIDATE
  本地策略引擎拒绝不安全、不落地或无证据计划

PREPARE
  根据已批准计划安全新增所需重复行，再重新观察

EXECUTE
  逐动作或逐行执行，非空人工值不覆盖

VERIFY
  重新扫描并逐目标回读

REPAIR
  对 partial/failed 动作最多重新规划两次

CHECKPOINT
  持久化计划、结果、人工覆盖和下一个动作位置

ADVANCE
  当前页无阻塞且不是高风险按钮时进入下一步
```

API 失败时：

- 已有本地高置信普通字段可继续填写并回读；
- 需要组合、拆分或页面语义推理的字段标记为待处理；
- 页面不得因这些未完成字段自动进入下一步；
- 工作台显示中转错误、是否可重试和受影响的字段/行。

## 9. 完整性与置信度

字段状态：

- `verified`：写入后回读一致；
- `manual`：检测到人工修改，受保护；
- `review`：有可解释计划但存在语义不确定性；
- `missing`：资料没有答案；
- `mismatch`：写入后网页值不一致；
- `failed`：目标不可操作或多次修复失败。

行状态由全部列聚合：

- 全部 `verified/manual`：绿色；
- 至少一列 `review/missing` 且无 mismatch/failed：橙色；
- 至少一列 `mismatch/failed`：红色；
- 只有部分列有计划或有值：橙色，并阻止自动翻页。

页面可以自动前进的条件：

1. 没有未填写的可见必填字段；
2. 没有 `mismatch` 或 `failed`；
3. 没有未处理的部分重复行；
4. 材料页面已经完成预览确认；
5. 当前按钮不是提交、确认报名、承诺、支付、删除或导师/志愿选择；
6. 页面签名在计划、执行和前进前保持一致。

## 10. 多站点与恢复

每个 `ApplicationTask` 独立保存 Agent 检查点。标签页只是当前执行载体，不是任务身份。相同网站的不同报名项目依据规范化 URL 参数、页面身份和用户创建的任务 ID 分离。

工作台默认展示当前标签页对应任务；同时允许查看全部网站。切换标签页或关闭侧边栏不停止任务。关闭标签页后任务进入可恢复状态，不自动绑定到其他同域标签页，除非页面身份匹配且用户重新启动该任务。

返回旧页面时：

1. 读取已保存页面计划；
2. 重新扫描真实网页值；
3. 标记与历史 Agent 值不同的非空值为人工覆盖；
4. 页面和资料指纹一致时恢复计划和标色；
5. 指纹变化时保留人工覆盖并重新规划其他字段。

## 11. UI 与可观察性

工作台的逐页记录必须展示：

- 页面名称；
- 当前 Agent 阶段；
- 页面计划是否来自缓存；
- 本地确定性计划数；
- AI 计划数；
- 已验证、人工修改、待确认、冲突和失败数量；
- 重复行整体完成数；
- API 错误和修复次数；
- 暂停原因；
- “查看本页计划”“定位字段”“重试失败项”“接受人工修改”“重新规划本页”操作。

默认不显示完整 API Key，不在日志中打印完整个人资料或模型原始响应。开发日志也必须脱敏。

## 12. 安全与隐私

- 个人资料默认保存在浏览器本地；
- 只有运行 Agent 或其他明确 AI 功能时，必要的页面语义和候选资料发送到用户配置的中转；
- API Key 不进入缓存指纹、Git、导出资料、任务日志或截图；
- 页面快照不包含密码、验证码、隐藏 token、cookie 和无关网页正文；
- 密码输入框和受保护字段不得扫描值、不得发送模型、不得填写；
- 模型计划必须经过本地策略验证；
- 真实系统测试只允许扫描、填写、上传到可覆盖的临时位置、预览、保存页内草稿和安全下一步；绝不最终提交。

## 13. 兼容性

主目标：

- Microsoft Edge 当前稳定版；
- Google Chrome 当前稳定版；
- Manifest V3。

Firefox 构建继续保留现有基础功能。依赖 Chrome 专属能力的 Agent 特性必须进行能力检测；无法支持时显示明确降级状态，不能静默失败。Chrome 内置 AI 不属于本版本依赖。

## 14. 测试策略

所有新生产逻辑遵循测试先行。

纯逻辑测试至少覆盖：

- 页面字段聚合为单字段组、重复组和整段组；
- 页面说明中的日期格式、maxlength 和禁用字符提取；
- 奖励页候选资料检索；
- 学习与工作履历只接受 `education_career`；
- 整行计划的同记录约束；
- 多字段组合值的证据校验；
- 模型虚构 recordId、targetId 或 evidenceFields 时拒绝；
- 人工非空值不覆盖；
- 部分行聚合为橙色并阻止前进；
- API 结构化输出不支持时单次兼容回退；
- 502 时不误判为页面成功；
- 计划缓存命中和失效；
- 检查点休眠恢复；
- 每动作最多两次修复；
- 提交、承诺、导师、验证码等动作永远拒绝。

DOM 策略测试至少覆盖：

- 复旦“时间、地点、内容”17 行奖励表格；
- “起始时间、结束时间、学校或工作单位、担任职务”履历表；
- 字段顺序变化；
- 同一记录整段输入框；
- Vue/React 受控输入；
- 搜索弹窗多个“选择/确定”按钮；
- 重复行新增后重新扫描；
- 返回旧页面恢复标色但不覆盖人工修改。

真实验收至少覆盖：

- 复旦真实系统：奖励表、学习和工作经历、连续填写、页面缓存、返回页标色；
- 东南大学真实系统：基本信息、选择控件、连续填写；
- 中山大学真实系统：多个报名项目的任务隔离和恢复；
- 到最终审核页停止，不点击最终提交。

真实测试中的任何新问题必须先增加可重复失败测试，再修改生产代码。

## 15. 验收标准

1. 复旦奖励页不再出现只填时间却标绿并翻页；
2. Agent 能将学科竞赛和荣誉奖励转换为当前页面实际要求的完整结构；
3. 每个生成值可追溯到来源记录和证据字段；
4. 资料缺失或语义不确定时暂停并解释，不编造；
5. 学习与工作履历仅使用用户录入的两条履历，不混入科研、实践或社会工作；
6. 页面顺序和字段命名变化时通过页面快照重新规划，不依赖学校特例；
7. 已填写字段经过回读比较，人工修改得到保护；
8. 同一页面重复进入时恢复计划、标色和建议，不重复请求 API；
9. 扩展后台休眠或侧边栏关闭后，任务可从检查点恢复；
10. 多网站、多项目任务状态隔离，工作台优先展示当前网站；
11. API 502、超时或格式错误不会清空已填内容，不会自动翻页；
12. 材料自动匹配后提供包含题目名称和文件名的预览，并等待确认；
13. 最终审核页停止；所有最终提交和高风险动作不可由 Agent 调用；
14. 全部自动化测试、TypeScript 编译、Chrome 构建和 Firefox 构建通过；
15. README、版本号、Git 标签和 Release 与 `1.6.0` 一致，不包含个人资料、API Key、登录状态或真实材料。

## 16. 发布边界

`1.6.0` 是 Agent 架构版本。此前尚未发布的 `1.5.1` 修复合并进入 `1.6.0`，不再单独创建 `v1.5.1` Release。现有 `v1.5.0` 标签保持不变。

发布附件：

```text
baotian-1.6.0-chrome.zip
baotian-1.6.0-firefox.zip
```

正式 Release 之前必须完成：

- 脱敏 README 截图；
- 中英文 README 更新；
- 完整测试和双浏览器构建；
- 压缩包 manifest 版本核对；
- GitHub Release 下载附件核对；
- 用户正常 Edge 解压扩展目录备份、覆盖和 manifest 版本核对。
