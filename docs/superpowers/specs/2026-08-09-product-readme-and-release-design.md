# 产品主页型 README 与 v1.5.1 Release 设计

日期：2026-08-09

## 背景

当前中文 README 仍以旧版功能清单为主，首页信息密度过高，并继续使用“学习和工作经历、学术成果、奖励情况”三类旧资料描述。现有三张展示图还显示“秒填鸭”和已经不再作为主要入口的“流式自动填充”，无法代表“保填”当前界面。英文 README 也没有同步 1.5.0 的精确七类资料、跨网站目标结构投影和长问题 API 能力。

仓库已经存在 `v1.5.0` 标签，但 GitHub 上没有对应 Release。本地 `.output` 中只保留了过期的 `auto-filler-1.0.0-chrome.zip`，不能作为当前版本安装包发布。

## 目标

1. 将中文 README 重做为面向普通用户的产品主页，同时保留必要的开发信息。
2. 同步更新英文 README，避免不同语言页面描述不同版本。
3. 用当前“保填”界面替换仍显示“秒填鸭”的过期截图。
4. 将版本提升为 `1.5.1`，保证 README、扩展清单、压缩包名称、Git 标签和 GitHub Release 一致。
5. 生成 Chrome/Edge 与 Firefox 安装包，创建正式 GitHub Release。
6. 不提交用户资料、API Key、浏览器缓存或真实报名页面中的敏感信息。

## README 定位

采用“产品主页型”结构，而不是把所有实现细节平铺在首页。

首页读者优先级：

1. 想快速了解和安装扩展的推免报名用户；
2. 想确认隐私、安全边界和 AI 数据流的用户；
3. 想从源码构建、测试或贡献代码的开发者。

README 不宣传“完全自动报名”或“适配所有网站”，统一使用“辅助填充”“结构相近页面”“需要本人最终核对”等保守表述。

## 中文 README 结构

### 1. 首屏

- 居中显示新版 `assets/logo.png`；
- 产品名“保填”与一句话定位；
- 版本、许可证、TypeScript、Chrome/Edge、Firefox 等简洁徽章；
- “下载最新版”“快速开始”“隐私说明”三个入口；
- 明确标注“本地资料管理 + 可选 AI 增强 + 不自动提交”。

### 2. 当前版本亮点

用短表格展示 `v1.5.1` 所包含的当前能力，重点说明：

- 精确七类重复资料；
- 跨网站字段结构投影；
- 拆分子字段、重复表格、弹窗新增与整段文本框；
- 长问题的 Fast/标准 API 处理；
- 页面语义缓存、已填写值保护和返回页面结果恢复；
- 多标签页连续填写与统一最终检查；
- 材料推荐、题目名称展示、预览确认和 PDF 合成。

`v1.5.1` 是文档、截图、安装包和发布流程整理版，不声称新增尚未实现的报名行为。

### 3. 产品截图

替换旧的三张图片，至少包含：

1. 当前弹窗首页或当前网站任务状态；
2. 页面扫描结果或置信度预览；
3. 资料管理中的精确七类重复资料；
4. 如界面稳定，再增加材料预览或统一审核中心。

截图必须满足：

- 显示“保填”，不得出现“秒填鸭”；
- 不包含姓名、电话、身份证、API Key、学校登录信息或真实报名链接；
- 优先使用演示数据或遮蔽后的数据；
- 统一宽度、圆角和说明文字，避免三张窄图无层次并排。

### 4. 三步使用

1. 在资料中心维护信息并导出备份；
2. 打开报名页面，扫描、核对并填写当前页，或启动连续填写；
3. 在最终审核页和统一审核中心逐项检查，由用户本人决定是否提交。

### 5. 精确七类资料

明确列出：科研训练、实习实践、社会工作、已发表论文、已取得专利、学科竞赛、本科期间校级以上（含）荣誉奖励，并解释它们如何投影到其他网站常见的“论文情况、项目经历、获奖情况”。基本信息、家庭成员、学习信息和外语水平作为常用基础资料单独说明，避免把“七类”误解成全部资料只有七组。

### 6. 复杂页面与 AI

简要解释本地确定性匹配优先、AI 处理歧义和长问题、结果回读、缓存及人工确认。列出 Chat Completions、Responses、自定义 Base URL、模型名和可选 Fast 模式，但不在 README 写入任何真实 API Key 或中转账号。

### 7. 安装与更新

- Chrome/Edge/Brave 从 Release 下载 `baotian-1.5.1-chrome.zip`；
- Firefox 下载 `baotian-1.5.1-firefox.zip`；
- 说明开发者模式与加载解压缩目录；
- 单独给出“重新加载仍是旧版本”的排查：确认扩展卡片的加载位置，固定使用同一个目录，并核对目录内 `manifest.json`；
- 说明保持扩展 ID 和加载目录可保留 IndexedDB 与 `chrome.storage.local` 数据；删除扩展或换目录前先导出备份。

### 8. 安全与隐私

清楚区分：

- 默认保存在浏览器本地的数据；
- 主动使用 AI 时会发送的必要文本或材料抽样内容；
- 永不自动执行的最终提交、验证码、承诺书、支付、志愿和导师选择；
- 所有自动填写结果必须由本人审核。

### 9. 开发者信息

将技术栈、项目结构、开发命令、完整测试命令、构建和打包放在 README 后半部分。避免重复展开内部实现细节，详细设计链接到 `docs/superpowers/specs/`。

## 英文 README

英文 README 与中文 README 使用相同信息架构和版本信息，但采用自然英文表达，不做逐句机械翻译。安装包名称、七类资料的稳定含义、安全边界和开发命令必须一致。

## 版本与构建

版本从 `1.5.0` 提升至 `1.5.1`，同步修改项目版本来源，使以下内容一致：

- `package.json`；
- `package-lock.json`；
- Chrome/Edge 构建的 `manifest.json`；
- Firefox 构建的 `manifest.json`；
- README 徽章与下载说明；
- 压缩包文件名；
- Git 标签与 GitHub Release。

构建和测试至少执行：

```text
npm run compile
npm run test:profile
npm run test:profile-projections
npm run test:long-question
npm run test:local-matcher
npm run test:repeatable-records
npm run test:repeatable-row-request
npm run test:repeatable-dialog
npm run test:tasks
npm run test:page-analysis-recovery
npm run test:audit
npm run test:ai-queue
npm run test:material-audit
npm run test:audit-view-model
npm run test:page-identity
npm run test:llm-api
npm run build
npm run build:firefox
npm run zip
npm run zip:firefox
npm audit --omit=dev --audit-level=high
```

## Release 设计

创建正式的 `v1.5.1` Release，而不是继续使用只有标签、没有附件的 `v1.5.0`。

Release 内容包括：

- 标题：`保填 v1.5.1`；
- Chrome/Edge/Brave 压缩包；
- Firefox 压缩包；
- 简明更新摘要；
- 安装和升级步骤；
- 资料备份提醒；
- AI 与安全边界；
- 已知限制：复杂地区/院校/专业弹窗、验证码、文件格式限制和不同学校校验规则仍可能需要人工处理。

发布前必须确认：

- 工作区只有本次有意修改；
- 安装包内版本为 `1.5.1`；
- 压缩包不包含 `.env`、API Key、用户 JSON、真实材料或浏览器数据；
- 中文和英文 README 的链接有效；
- Git 提交已推送到 `origin/main`；
- `v1.5.1` 标签指向经过验证的最终提交；
- GitHub Release 附件大小和名称正确。

## 非目标

- 不在本轮新增报名自动提交能力；
- 不开发 Word/PDF 个人资料智能导入；
- 不为了截图操作真实报名系统或提交表单；
- 不公开用户个人资料、API 配置或学校登录状态；
- 不移动或重写既有 `v1.5.0` 标签。

