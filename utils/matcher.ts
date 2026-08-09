import type { ApiConfig, ApiMode } from './storage';
import {
  buildLongQuestionPrompt,
  chunkLongQuestionContext,
  mergeLongQuestionDrafts,
  type LongQuestionDraft,
  type LongQuestionRequest,
} from './long-question';

export interface FormFieldInfo {
  kind?: 'text' | 'file';
  index: number;
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  hint?: string;
  placeholder: string;
  ariaLabel: string;
  title?: string;
  dateFormat?: string;
  maxLength?: number;
  forbiddenCharacters?: string[];
  value?: string;
  options?: string[];
  accept?: string;
  multiple?: boolean;
  hasExistingFile?: boolean;
  fillMode?: 'short' | 'long';
  renderWidth?: number;
  renderHeight?: number;
  context: string;
  html?: string;
  required?: boolean;
  groupLabel?: string;
  columnLabel?: string;
  rowIndex?: number;
  repeatGroup?: string;
  selectionMode?: 'dialog';
  protected?: boolean;
  protectionReason?: string;
}

export type MaterialRole =
  | 'application_form'
  | 'id_card'
  | 'id_photo'
  | 'id_card_front'
  | 'id_card_back'
  | 'transcript'
  | 'ranking_proof'
  | 'cet4_certificate'
  | 'cet6_certificate'
  | 'language_certificate'
  | 'award_certificate'
  | 'academic_proof'
  | 'practice_proof'
  | 'student_card'
  | 'recommendation_letter'
  | 'mentor_consent'
  | 'enrollment_certificate'
  | 'resume';

export interface MatchResult {
  kind?: 'text' | 'file';
  index: number;
  fieldKey: string;
  value: string;
  shortLabel: string;
  confidence: 'high' | 'medium' | 'low';
  fillMode?: 'short' | 'long';
  fileRecordId?: number;
  fileName?: string;
  fileType?: string;
  materialRole?: MaterialRole;
  fileCandidates?: Array<{
    fileRecordId: number;
    fileName: string;
    fileType: string;
  }>;
  source?: 'local' | 'ai' | 'ai_reviewed' | 'material';
}

export interface AuditVisualInput {
  filename: string;
  mimeType: string;
  dataUrl: string;
  pageNumber: number;
}

export interface AuditModelResult {
  text: string;
  usedVisuals: boolean;
  degradedReason?: string;
}

function sourceLeafKey(fieldKey: string): string {
  return fieldKey.split('.').at(-1) ?? fieldKey;
}

function sourceGroupKey(fieldKey: string): string {
  return fieldKey.match(/^(.+?)\[\d+\]\./)?.[1] ?? '';
}

function normalizeGroupKey(value: string): string {
  return value.toLowerCase().replace(/[\s　：:，,。；;（）()【】\[\]\/|｜_*#与和]/g, '');
}

function isRepeatGroupSourceCompatible(targetGroup: string, sourceGroup: string): boolean {
  const target = normalizeGroupKey(targetGroup);
  const source = normalizeGroupKey(sourceGroup);
  if (!target || !source) return true;

  const targetMatches = (pattern: RegExp) => pattern.test(target);
  const sourceMatches = (pattern: RegExp) => pattern.test(source);
  if (targetMatches(/学习工作经历|学习工作履历|教育经历|工作履历/)) {
    return sourceMatches(/学习工作经历|学习工作履历|教育经历|工作履历/);
  }
  if (targetMatches(/项目经历|项目经验|科研实践/)) {
    return sourceMatches(/项目经历|科研训练|实习实践|社会工作/);
  }
  if (targetMatches(/家庭成员|社会关系/)) return sourceMatches(/家庭成员|社会关系/);
  if (targetMatches(/外语水平|英语考试|四六级/)) return sourceMatches(/外语水平|英语考试|四六级/);
  if (targetMatches(/科研训练|科研项目|研究项目/)) return sourceMatches(/科研训练|科研项目|研究项目/);
  if (targetMatches(/实习实践|实习经历|实践经历/)) return sourceMatches(/实习实践|实习经历|实践经历/);
  if (targetMatches(/社会工作|学生工作|社会职务/)) return sourceMatches(/社会工作|学生工作|社会职务/);
  if (targetMatches(/论文情况|已发表论文|论文成果/)) return sourceMatches(/已发表论文|论文情况|论文成果/);
  if (targetMatches(/已取得专利|专利情况|专利成果/)) return sourceMatches(/已取得专利|专利情况|专利成果/);
  if (targetMatches(/获奖情况|奖励情况|学科竞赛|荣誉奖励/)) {
    return sourceMatches(/获奖情况|奖励情况|学科竞赛|荣誉奖励/);
  }
  if (targetMatches(/学术成果|科研成果/)) {
    return sourceMatches(/已发表论文|论文情况|已取得专利|专利情况|学科竞赛/);
  }
  return true;
}

export function isSemanticallyCompatibleMatch(field: FormFieldInfo | undefined, fieldKey: string): boolean {
  if (!field || !fieldKey) return false;
  if (field.fillMode === 'long' && fieldKey === 'generated_long_text') return true;
  const target = [field.columnLabel, field.label, field.placeholder, field.ariaLabel, field.title]
    .filter(Boolean)
    .join(' ');
  const source = sourceLeafKey(fieldKey);
  const sourceGroup = sourceGroupKey(fieldKey);

  if (field.groupLabel && sourceGroup && !isRepeatGroupSourceCompatible(field.groupLabel, sourceGroup)) {
    return false;
  }

  if (/固定电话|座机|住宅电话|办公电话/.test(target)) {
    return /固定电话|座机|住宅电话|办公电话/.test(source);
  }
  if (/电话|手机|联系方式/.test(target) && /地址|住址|籍贯|出生地|户口|邮编|邮政编码/.test(source)) {
    return false;
  }
  if (/地址|住址|籍贯|出生地|户口/.test(target) && /电话|手机|联系方式/.test(source)) {
    return false;
  }
  if (/邮编|邮政编码/.test(target) && !/邮编|邮政编码/.test(source)) return false;
  if (/电子邮箱|邮箱|e-?mail/i.test(target) && !/电子邮箱|邮箱|e-?mail/i.test(source)) return false;
  return true;
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildPrompt(fields: FormFieldInfo[], textFields: { key: string; value: string }[]): string {
  const availableKeys = textFields.map(({ key, value }) => `  "${key}": "${value}"`);

  const fieldList = fields
    .map((f) => {
      const label = truncateText(f.label || f.placeholder || f.ariaLabel || f.title || '', 40);
      const hint = truncateText(f.hint || '', 80);
      const context = truncateText(f.context || '', 120);
      const html = truncateText(f.html || '', 500);
      const technical = [f.name && `name=${f.name}`, f.id && `id=${f.id}`].filter(Boolean).join(', ');
      const options = f.options?.length ? `, options="${f.options.join(' / ')}"` : '';
      const dateFormat = f.dateFormat ? `, dateFormat="${f.dateFormat}"` : '';
      const currentValue = f.value ? `, currentValue="${f.value}"` : '';
      const fillMode = f.fillMode ?? 'short';
      const size = f.renderWidth && f.renderHeight ? `, renderedSize=${f.renderWidth}x${f.renderHeight}` : '';
      const repeat = f.groupLabel || f.columnLabel || f.rowIndex != null
        ? `, group="${f.groupLabel ?? ''}", row=${f.rowIndex != null ? f.rowIndex + 1 : ''}, column="${f.columnLabel ?? ''}"`
        : '';
      return `  [${f.index}] tag=${f.tag}, type=${f.type}, fillMode=${fillMode}${size}, label="${label}", hint="${hint}", context="${context}", html="${html}"${repeat}${options}${dateFormat}${currentValue}${technical ? `, ${technical}` : ''}`;
    })
    .join('\n');

  return `你是一个表单字段语义匹配助手。请将以下网页表单字段与用户个人信息进行匹配。

## 用户个人信息（字段名: 值）
${availableKeys.join('\n')}

## 网页表单字段
${fieldList}

## 填充长度分类
- fillMode=short：短填充项，例如姓名、性别、民族、证件号、电话、邮箱、日期、下拉选项等。value 必须简洁，优先直接匹配或格式化已有个人信息。
- fillMode=long：长文本项，通常是渲染尺寸较大的 textarea 或富文本编辑区，例如个人陈述、申请理由、自我介绍、备注说明等。value 必须由你参考“用户个人信息”里的全部可用信息生成一段自然、连贯、可直接粘贴的长文本，而不是只返回某一个字段值。
- 对 long 字段，fieldKey 可以使用 "generated_long_text"，表示这是综合生成内容，不要求对应单一用户字段。
- 对 long 字段，严禁编造未提供的学校、奖项、经历、职务、证书等事实；可以用已提供的姓名、身份信息、地址、联系方式等基础信息组织成稳妥表述。若页面上下文有明确主题，应围绕主题生成；若主题只是“个人陈述/自我介绍”，生成通用、正式、第一人称中文文本。

## 规则
- 根据语义匹配，不要只看关键词。例如"请输入您的真实姓名"应匹配"姓名"。
- 只能使用"用户个人信息"中已有的信息直接匹配或派生，不要凭空编造未提供的信息。
- 需要重点做同义、格式和派生推理。例如用户只有中文姓名，网页字段是"姓名拼音 / name pinyin"，应返回姓名的拼音；"证件号码"可由"身份证号"匹配；"证件号码后四位"应返回身份证号后四位；"出生日期"可直接使用或从身份证号第 7-14 位派生；"手机号后四位"应返回手机号后四位；"邮箱前缀"应返回 @ 前面的部分；"省/市/区"应从地址或户籍地址中拆出对应部分。
- 如果字段要求拼音，使用普通话汉语拼音，小写、无声调；如果页面暗示大写、空格或英文格式，可按页面要求调整。
- 如果页面提示"字母间不加任何字符 / 中间无空格 / 紧左原则"，姓名拼音应去掉空格，例如"刘智杰"应填"liuzhijie"。
- 通讯地址、通信地址可优先匹配"地址"；户口所在地详细地址、户籍地址可优先匹配"户籍地址"。
- 民族、性别、婚否、政治面貌等下拉项应根据 options 中最接近的选项文本匹配，value 返回网页可接受的选项文本。
- 优先依据 label、hint、html 中的当前字段行/局部容器理解字段含义；context 只是辅助信息；name/id 只是技术标识，含义不清时不要强行匹配
- 字段带有 currentValue 时仍要返回根据“用户个人信息”推导出的正确期望值，用于核对页面现值；不要为了迎合页面而直接照抄 currentValue。
- 每个表单字段最多匹配一个用户字段。无法推理出合理值时不要返回该字段。
- 对 group、row、column 描述的多行资料，必须按“分组 + 行号 + 子字段语义”匹配：网页列顺序可以与资料顺序不同，但第 N 行只能取用户资料中同一分组第 N 条的数据。
- 多行资料的 fieldKey 必须原样返回用户个人信息中提供的完整 key，例如“奖励情况[2].奖励名称”；不得把第 1 条和第 2 条资料交叉，也不得只因为网页列顺序变化就改变条目顺序。
- **特别重要：fillMode=long 的长文本字段必须返回匹配项，绝对不可跳过。** 即使页面上下文不明确，也要综合用户全部信息生成一段通顺稳妥的自我介绍/个人陈述文本。
- 为每个返回项生成一个简短字段名 shortLabel，2 到 8 个中文字符或简短英文，不要直接复制很长的上下文。
- confidence 只能是 high、medium、low：
  - high：字段含义和取值都明确，几乎可直接填。
  - medium：语义基本匹配，但有格式/派生推理或上下文略有歧义。
  - low：可能匹配，但需要用户重点确认。
- 对 fillMode=long 的字段，confidence 固定为 high。

## 输出格式
返回 JSON 数组，每个元素包含：
- index: 表单字段的索引（数字）
- fieldKey: 匹配的用户字段 key（字符串）
- value: 要填入网页表单的最终值（字符串，可为派生/格式化后的值）
- shortLabel: 简短字段名（字符串）
- confidence: "high" | "medium" | "low"

只返回 JSON 数组，不要其他内容。如果没有任何匹配，返回空数组 []。`;
}

function normalizeConfidence(value: unknown): MatchResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function fallbackShortLabel(field: FormFieldInfo | undefined, fieldKey: string, index: number): string {
  const raw =
    field?.label ||
    field?.placeholder ||
    field?.ariaLabel ||
    field?.title ||
    fieldKey ||
    `字段${index}`;
  const compact = raw.replace(/\s+/g, '').replace(/[：:，,。；;|｜]/g, ' ');
  return compact.slice(0, 12) || `字段${index}`;
}

function getApiMode(apiConfig: ApiConfig): ApiMode {
  return apiConfig.apiMode === 'responses' ? 'responses' : 'chat_completions';
}

export function getRequestUrl(apiConfig: ApiConfig): string {
  const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
  return `${baseUrl}/${getApiMode(apiConfig) === 'responses' ? 'responses' : 'chat/completions'}`;
}

export interface ModelJsonSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ModelRequestOptions {
  stream?: boolean;
  jsonSchema?: ModelJsonSchema;
}

export function getRequestBody(
  apiConfig: ApiConfig,
  prompt: string,
  streamOrOptions: boolean | ModelRequestOptions = false,
): Record<string, unknown> {
  const options = typeof streamOrOptions === 'boolean'
    ? { stream: streamOrOptions }
    : streamOrOptions;
  const stream = options.stream ?? false;
  const common = {
    model: apiConfig.model,
    stream,
    ...(apiConfig.fastMode ? { service_tier: 'fast' } : {}),
  };

  if (getApiMode(apiConfig) === 'responses') {
    return {
      ...common,
      input: prompt,
      store: false,
      ...(options.jsonSchema ? {
        text: {
          format: {
            type: 'json_schema',
            name: options.jsonSchema.name,
            schema: options.jsonSchema.schema,
            strict: options.jsonSchema.strict ?? true,
          },
        },
      } : {}),
    };
  }

  return {
    ...common,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    ...(options.jsonSchema ? {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: options.jsonSchema.name,
          schema: options.jsonSchema.schema,
          strict: options.jsonSchema.strict ?? true,
        },
      },
    } : {}),
  };
}

export function getAuditRequestBody(
  apiConfig: ApiConfig,
  prompt: string,
  visuals: AuditVisualInput[],
): Record<string, unknown> {
  if (getApiMode(apiConfig) !== 'responses' || visuals.length === 0) {
    return getRequestBody(apiConfig, prompt, false);
  }
  return {
    model: apiConfig.model,
    stream: false,
    ...(apiConfig.fastMode ? { service_tier: 'fast' } : {}),
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...visuals.map((visual) => ({ type: 'input_image', image_url: visual.dataUrl })),
      ],
    }],
    store: false,
  };
}

export function extractResponseText(data: unknown, apiMode: ApiMode): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;

  if (apiMode === 'chat_completions') {
    const choices = record.choices;
    if (!Array.isArray(choices)) return '';
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    return typeof message?.content === 'string' ? message.content : '';
  }

  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return '';

  return record.output.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === 'string' ? [text] : [];
    });
  }).join('');
}

export function extractStreamText(data: unknown, apiMode: ApiMode): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;

  if (apiMode === 'responses' && record.type === 'response.output_text.delta') {
    return typeof record.delta === 'string' ? record.delta : '';
  }

  const choices = record.choices;
  if (!Array.isArray(choices)) return '';
  const first = choices[0] as Record<string, unknown> | undefined;
  const delta = first?.delta as Record<string, unknown> | undefined;
  return typeof delta?.content === 'string' ? delta.content : '';
}

export function extractStreamError(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  if (record.type !== 'error' && record.type !== 'response.failed') return '';

  const error = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : undefined;
  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : undefined;
  const responseError = response?.error && typeof response.error === 'object'
    ? response.error as Record<string, unknown>
    : undefined;

  return String(error?.message ?? responseError?.message ?? '模型流式响应失败');
}

async function throwApiError(response: Response): Promise<never> {
  const raw = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html') || /^\s*<!doctype html/i.test(raw);
  const detail = isHtml
    ? '上游网关返回了 HTML 错误页，请检查中转线路或稍后重试'
    : raw.slice(0, 1200);
  throw new Error(`LLM API error ${response.status}: ${detail}`);
}

export function isUnsupportedMultimodalError(status: number, raw: string): boolean {
  if (![400, 404, 415, 422].includes(status)) return false;
  return /input[_ -]?(?:image|file)|image[_ -]?(?:url|input)|multimodal|vision|unsupported|not supported|unknown (?:content|input) type/i.test(raw);
}

async function postModelRequest(apiConfig: ApiConfig, body: Record<string, unknown>): Promise<Response> {
  return fetch(getRequestUrl(apiConfig), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function extractModelResponse(response: Response, apiMode: ApiMode): Promise<string> {
  if (!response.ok) await throwApiError(response);
  const data = await response.json();
  const content = extractResponseText(data, apiMode);
  if (!content) throw new Error('模型返回了空内容');
  return content;
}

export async function requestAuditModel(
  apiConfig: ApiConfig,
  prompt: string,
  visuals: AuditVisualInput[],
): Promise<AuditModelResult> {
  if (!apiConfig.model.trim()) throw new Error('请先在设置中填写模型名称');
  const apiMode = getApiMode(apiConfig);
  if (apiMode !== 'responses' || visuals.length === 0) {
    const text = await extractModelResponse(
      await postModelRequest(apiConfig, getRequestBody(apiConfig, prompt, false)),
      apiMode,
    );
    return {
      text,
      usedVisuals: false,
      ...(visuals.length > 0 ? { degradedReason: '当前 API 模式不支持材料图像，已改用文本与元数据审核' } : {}),
    };
  }

  const response = await postModelRequest(apiConfig, getAuditRequestBody(apiConfig, prompt, visuals));
  if (response.ok) {
    return { text: await extractModelResponse(response, apiMode), usedVisuals: true };
  }

  const raw = await response.text();
  if (!isUnsupportedMultimodalError(response.status, raw)) {
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('text/html') || /^\s*<!doctype html/i.test(raw);
    const detail = isHtml
      ? '上游网关返回了 HTML 错误页，请检查中转线路或稍后重试'
      : raw.slice(0, 1200);
    throw new Error(`LLM API error ${response.status}: ${detail}`);
  }

  const textResponse = await postModelRequest(apiConfig, getRequestBody(apiConfig, prompt, false));
  return {
    text: await extractModelResponse(textResponse, apiMode),
    usedVisuals: false,
    degradedReason: '当前模型线路不支持材料图像，已改用文本与元数据审核',
  };
}

export async function requestModelText(
  apiConfig: ApiConfig,
  prompt: string,
  options: ModelRequestOptions = {},
): Promise<string> {
  if (!apiConfig.model.trim()) throw new Error('请先在设置中填写模型名称');
  const apiMode = getApiMode(apiConfig);
  return extractModelResponse(
    await postModelRequest(apiConfig, getRequestBody(apiConfig, prompt, options)),
    apiMode,
  );
}

function buildLongQuestionRecords(textFields: { key: string; value: string }[]): LongQuestionRequest['relevantRecords'] {
  const records = new Map<string, LongQuestionRequest['relevantRecords'][number]>();
  for (const field of textFields) {
    const value = field.value.trim();
    if (!value) continue;
    const structured = field.key.match(/^(.+?)\[(\d+)\]\.(.+)$/);
    if (!structured) {
      const key = 'flat:0';
      const record = records.get(key) ?? { sectionId: 'flat', itemIndex: 0, fields: {} };
      record.fields[field.key] = value;
      records.set(key, record);
      continue;
    }
    const [, sectionId, rawIndex, fieldKey] = structured;
    const itemIndex = Math.max(Number(rawIndex) - 1, 0);
    const key = `${sectionId}:${itemIndex}`;
    const record = records.get(key) ?? { sectionId, itemIndex, fields: {} };
    record.fields[fieldKey] = value;
    records.set(key, record);
  }
  return [...records.values()];
}

function parseLongQuestionDraft(content: string, request: LongQuestionRequest): LongQuestionDraft {
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const raw = JSON.parse(objectMatch[0]) as Partial<LongQuestionDraft>;
      if (typeof raw.text === 'string' && raw.text.trim()) {
        return {
          text: raw.text.trim(),
          sourceRefs: Array.isArray(raw.sourceRefs) ? raw.sourceRefs.flatMap((ref) => {
            if (!ref || typeof ref !== 'object') return [];
            const candidate = ref as Record<string, unknown>;
            return typeof candidate.sectionId === 'string' && Number.isFinite(Number(candidate.itemIndex))
              ? [{
                sectionId: candidate.sectionId,
                itemIndex: Number(candidate.itemIndex),
                fieldKeys: Array.isArray(candidate.fieldKeys) ? candidate.fieldKeys.map(String) : [],
              }]
              : [];
          }) : [],
          missingFacts: Array.isArray(raw.missingFacts) ? raw.missingFacts.map(String).filter(Boolean) : [],
          needsReview: true,
        };
      }
    } catch {
      // Fall through to a conservative raw-text draft.
    }
  }
  return {
    text: content.trim(),
    sourceRefs: request.relevantRecords.map((record) => ({
      sectionId: record.sectionId,
      itemIndex: record.itemIndex,
      fieldKeys: Object.keys(record.fields),
    })),
    missingFacts: ['模型未按 JSON 格式返回，需人工核对草稿内容'],
    needsReview: true,
  };
}

async function requestLongQuestionMatch(
  field: FormFieldInfo,
  apiConfig: ApiConfig,
  textFields: { key: string; value: string }[],
): Promise<MatchResult | undefined> {
  const context = textFields.map(({ key, value }) => `${key}：${value}`).join('\n\n');
  const maxInputChars = 9000;
  const chunks = chunkLongQuestionContext(context, maxInputChars);
  if (!chunks.length) return undefined;
  const request: LongQuestionRequest = {
    question: [field.label, field.placeholder, field.ariaLabel, field.hint, field.context]
      .filter(Boolean)
      .join('；')
      .slice(0, 800),
    targetField: field.columnLabel || field.label || field.placeholder || '长文本字段',
    pageContext: [field.groupLabel, field.context, field.html].filter(Boolean).join('；').slice(0, 1600),
    relevantRecords: buildLongQuestionRecords(textFields),
    mode: apiConfig.fastMode ? 'fast' : 'standard',
    maxInputChars,
    maxOutputChars: 4000,
  };
  const drafts: LongQuestionDraft[] = [];
  const selectedChunks = apiConfig.fastMode ? chunks.slice(0, 1) : chunks.slice(0, 6);
  for (const chunk of selectedChunks) {
    const content = await requestModelText(apiConfig, buildLongQuestionPrompt(request, chunk));
    drafts.push(parseLongQuestionDraft(content, request));
  }
  const merged = mergeLongQuestionDrafts(drafts, request.maxOutputChars);
  if (!merged.text) return undefined;
  return {
    kind: 'text',
    index: field.index,
    fieldKey: 'generated_long_text',
    value: merged.text,
    shortLabel: fallbackShortLabel(field, 'generated_long_text', field.index),
    confidence: 'high',
    fillMode: 'long',
    source: 'ai',
  };
}

export async function matchFields(
  fields: FormFieldInfo[],
  apiConfig: ApiConfig,
  textFields: { key: string; value: string }[],
): Promise<MatchResult[]> {
  if (fields.length === 0 || textFields.length === 0) return [];

  const textLikeFields = fields.filter((field) => field.kind !== 'file');
  if (textLikeFields.length === 0) return [];
  if (!apiConfig.model.trim()) throw new Error('请先在设置中填写模型名称');

  const longFields = textLikeFields.filter((field) => field.fillMode === 'long');
  if (longFields.length > 0) {
    const shortMatches = await matchFields(
      textLikeFields.filter((field) => field.fillMode !== 'long'),
      apiConfig,
      textFields,
    );
    const longMatches: MatchResult[] = [];
    for (const field of longFields) {
      const match = await requestLongQuestionMatch(field, apiConfig, textFields);
      if (match) longMatches.push(match);
    }
    return [...shortMatches, ...longMatches];
  }

  const prompt = buildPrompt(textLikeFields, textFields);
  const url = getRequestUrl(apiConfig);

  console.group('%c🔍 LLM 匹配请求', 'color:#1E88E5;font-weight:bold');
  console.log('%cAPI:', 'color:#888', url);
  console.log('%cModel:', 'color:#888', apiConfig.model);
  console.log('%cAPI mode:', 'color:#888', getApiMode(apiConfig));
  console.log('%cPrompt:\n' + prompt, 'color:#333');
  console.groupEnd();

  const content = await requestModelText(apiConfig, prompt);

  console.group('%c✅ LLM 匹配响应', 'color:#4caf50;font-weight:bold');
  console.log('%cRaw:', 'color:#888', content);
  console.groupEnd();

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Invalid LLM response format');

  const rawResults = JSON.parse(jsonMatch[0]) as Array<Partial<MatchResult>>;
  const fieldByIndex = new Map(textLikeFields.map((f) => [f.index, f]));
  const sourceValueByKey = new Map(textFields.map((field) => [field.key, field.value]));
  const results: MatchResult[] = rawResults.map((r) => {
    const field = fieldByIndex.get(Number(r.index));
    const isLong = field?.fillMode === 'long';
    const fieldKey = String(r.fieldKey ?? '');
    const isStructured = field?.rowIndex != null && Boolean(field.groupLabel);
    const structuredPrefix = field?.rowIndex != null && field.groupLabel
      ? `${field.groupLabel}[${field.rowIndex + 1}].`
      : '';
    const groundedStructuredValue = isStructured && fieldKey.startsWith(structuredPrefix)
      ? sourceValueByKey.get(fieldKey)
      : undefined;
    return {
      kind: 'text',
      index: Number(r.index),
      fieldKey: isStructured && groundedStructuredValue == null ? '' : fieldKey,
      value: isStructured ? String(groundedStructuredValue ?? '') : String(r.value ?? ''),
      shortLabel: String(r.shortLabel || fallbackShortLabel(field, fieldKey, Number(r.index))),
      confidence: isLong ? 'high' : normalizeConfidence(r.confidence),
      fillMode: field?.fillMode,
      source: 'ai',
    };
  });

  console.group('%c📋 匹配结果', 'color:#ff9800;font-weight:bold');
  results.forEach((r) => console.log(`  [${r.index}] ${r.confidence} "${r.shortLabel}" "${r.fieldKey}" ← "${r.value}"`));
  console.groupEnd();

  const validIndices = new Set(textLikeFields.map((f) => f.index));
  return results.filter((r) => (
    validIndices.has(r.index) &&
    r.fieldKey &&
    r.value &&
    isSemanticallyCompatibleMatch(fieldByIndex.get(r.index), r.fieldKey)
  ));
}

// ─── Streaming parser ───────────────────────────────────────────────

export type ParserEvent =
  | { type: 'value_chunk'; index: number; chunk: string }
  | { type: 'match_complete'; match: MatchResult };

class IncrementalJsonParser {
  private buf = '';
  private pos = 0;
  private depth = 0;
  private inString = false;
  private esc = false;

  // Per-object state (reset on each top-level '{')
  private readingKey = false;
  private readingVal = false;
  private readingNum = false;
  private keyBuf = '';
  private valBuf = '';
  private numBuf = '';
  private curKey = '';
  private curIndex = -1;
  private isLong = false;
  private objStart = -1;
  private afterColon = false;

  // Long-text chunking
  private chunkBuf = '';

  // Unicode escape state
  private uniMode = false;
  private uniBuf = '';
  private uniCount = 0;

  private readonly fieldByIndex: Map<number, FormFieldInfo>;

  constructor(fields: FormFieldInfo[]) {
    this.fieldByIndex = new Map(fields.map((f) => [f.index, f]));
  }

  feed(chunk: string): ParserEvent[] {
    const events: ParserEvent[] = [];
    this.buf += chunk;

    while (this.pos < this.buf.length) {
      const ch = this.buf[this.pos];
      this.pos++;

      // ── unicode escape ──
      if (this.uniMode) {
        this.uniBuf += ch;
        if (++this.uniCount === 4) {
          this.uniMode = false;
          this.appendChar(String.fromCharCode(parseInt(this.uniBuf, 16)), events);
        }
        continue;
      }

      // ── escape sequence ──
      if (this.esc) {
        this.esc = false;
        switch (ch) {
          case '"': this.appendChar('"', events); break;
          case '\\': this.appendChar('\\', events); break;
          case 'n': this.appendChar('\n', events); break;
          case 't': this.appendChar('\t', events); break;
          case 'r': this.appendChar('\r', events); break;
          case 'u': this.uniMode = true; this.uniBuf = ''; this.uniCount = 0; break;
          default: break;
        }
        continue;
      }

      // ── backslash ──
      if (this.inString && ch === '\\') {
        this.esc = true;
        continue;
      }

      // ── string boundary ──
      if (ch === '"') {
        this.inString = !this.inString;
        if (this.inString) {
          if (this.depth >= 2 && this.afterColon && this.curKey) {
            this.readingVal = true;
            this.valBuf = '';
            this.chunkBuf = '';
            this.afterColon = false;
          } else if (this.depth >= 2 && !this.readingKey && !this.readingVal && !this.readingNum && !this.curKey) {
            this.readingKey = true;
            this.keyBuf = '';
          }
        } else {
          if (this.readingKey) {
            this.curKey = this.keyBuf;
            this.readingKey = false;
          } else if (this.readingVal) {
            this.finishValue(events);
            this.readingVal = false;
            this.curKey = '';
          }
        }
        continue;
      }

      // ── inside string: accumulate ──
      if (this.inString) {
        this.appendChar(ch, events);
        continue;
      }

      // ── outside string: structural characters ──
      if (ch === '[') {
        this.depth++;
        continue;
      }

      if (ch === ']') {
        this.depth--;
        continue;
      }

      if (ch === '{') {
        this.depth++;
        if (this.depth === 2) {
          this.objStart = this.pos - 1;
          this.resetObject();
        }
        continue;
      }

      if (ch === '}') {
        if (this.readingNum) this.finishNumber();
        if (this.depth === 2) this.tryCompleteObject(events);
        this.depth--;
        continue;
      }

      if (ch === ':') {
        this.afterColon = true;
        continue;
      }

      if (ch === ',') {
        if (this.readingNum) this.finishNumber();
        this.readingKey = false;
        this.readingVal = false;
        this.readingNum = false;
        this.curKey = '';
        continue;
      }

      // ── number value ──
      if (this.afterColon && /[\d\-]/.test(ch)) {
        this.readingNum = true;
        this.numBuf = ch;
        this.afterColon = false;
        continue;
      }
      if (this.readingNum && /[\d.eE+\-]/.test(ch)) {
        this.numBuf += ch;
        continue;
      }
      if (this.readingNum) {
        this.finishNumber();
      }

      // Skip whitespace and other chars
    }

    return events;
  }

  finalize(): ParserEvent[] {
    const events: ParserEvent[] = [];
    // Flush remaining long-text chunk
    if (this.isLong && this.chunkBuf.length > 0) {
      events.push({ type: 'value_chunk', index: this.curIndex, chunk: this.chunkBuf });
      this.chunkBuf = '';
    }
    // Try to complete a partial object
    if (this.depth === 2) {
      this.tryCompleteObject(events);
    }
    return events;
  }

  private appendChar(ch: string, events: ParserEvent[]): void {
    if (this.readingKey) {
      this.keyBuf += ch;
    } else if (this.readingVal) {
      this.valBuf += ch;
      if (this.curKey === 'value' && this.isLong) {
        this.chunkBuf += ch;
        if (this.chunkBuf.length >= 5) {
          events.push({ type: 'value_chunk', index: this.curIndex, chunk: this.chunkBuf });
          this.chunkBuf = '';
        }
      }
    }
  }

  private finishValue(events: ParserEvent[]): void {
    if (this.curKey === 'index') {
      this.curIndex = parseInt(this.valBuf, 10) || -1;
      const field = this.fieldByIndex.get(this.curIndex);
      this.isLong = field?.fillMode === 'long';
    } else if (this.curKey === 'value' && this.isLong && this.chunkBuf.length > 0) {
      events.push({ type: 'value_chunk', index: this.curIndex, chunk: this.chunkBuf });
      this.chunkBuf = '';
    }
  }

  private finishNumber(): void {
    if (this.curKey === 'index') {
      this.curIndex = parseInt(this.numBuf, 10) || -1;
      const field = this.fieldByIndex.get(this.curIndex);
      this.isLong = field?.fillMode === 'long';
    }
    this.readingNum = false;
  }

  private resetObject(): void {
    this.readingKey = false;
    this.readingVal = false;
    this.readingNum = false;
    this.curKey = '';
    this.curIndex = -1;
    this.isLong = false;
    this.keyBuf = '';
    this.valBuf = '';
    this.numBuf = '';
    this.chunkBuf = '';
    this.afterColon = false;
  }

  private tryCompleteObject(events: ParserEvent[]): void {
    try {
      const json = this.buf.substring(this.objStart, this.pos);
      const raw = JSON.parse(json) as Partial<MatchResult>;
      const index = Number(raw.index);
      const field = this.fieldByIndex.get(index);
      const isLongField = field?.fillMode === 'long';
      events.push({
        type: 'match_complete',
        match: {
          kind: 'text',
          index,
          fieldKey: String(raw.fieldKey ?? ''),
          value: String(raw.value ?? ''),
          shortLabel: String(raw.shortLabel || fallbackShortLabel(field, String(raw.fieldKey ?? ''), index)),
          confidence: isLongField ? 'high' : normalizeConfidence(raw.confidence),
          fillMode: field?.fillMode,
          source: 'ai',
        },
      });
    } catch {
      // incomplete object, will retry on next feed or finalize
    }
  }
}

export async function* matchFieldsStream(
  fields: FormFieldInfo[],
  apiConfig: ApiConfig,
  textFields: { key: string; value: string }[],
): AsyncGenerator<ParserEvent> {
  if (fields.length === 0 || textFields.length === 0) return;

  const textLikeFields = fields.filter((f) => f.kind !== 'file');
  if (textLikeFields.length === 0) return;
  if (!apiConfig.model.trim()) throw new Error('请先在设置中填写模型名称');

  const prompt = buildPrompt(textLikeFields, textFields);
  const apiMode = getApiMode(apiConfig);
  const url = getRequestUrl(apiConfig);

  console.group('%c🔍 LLM 流式匹配请求', 'color:#1E88E5;font-weight:bold');
  console.log('%cAPI:', 'color:#888', url);
  console.log('%cModel:', 'color:#888', apiConfig.model);
  console.log('%cAPI mode:', 'color:#888', apiMode);
  console.groupEnd();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify(getRequestBody(apiConfig, prompt, true)),
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream reader not available');

  const decoder = new TextDecoder();
  const parser = new IncrementalJsonParser(textLikeFields);
  let partialLine = '';
  let done = false;

  try {
    while (!done) {
      const result = await reader.read();
      if (result.done) break;

      const text = partialLine + decoder.decode(result.value, { stream: true });
      const lines = text.split('\n');
      partialLine = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trimStart();
        if (payload === '[DONE]') { done = true; break; }

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const streamError = extractStreamError(parsed);
        if (streamError) throw new Error(`LLM stream error: ${streamError}`);

        const content = extractStreamText(parsed, apiMode);
        if (content) {
          for (const event of parser.feed(content)) {
            yield event;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Flush remaining content
  for (const event of parser.finalize()) {
    yield event;
  }

  console.group('%c✅ LLM 流式匹配完成', 'color:#4caf50;font-weight:bold');
  console.groupEnd();
}
