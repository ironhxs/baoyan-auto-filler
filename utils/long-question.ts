export type LongQuestionMode = 'fast' | 'standard';

export interface LongQuestionRequest {
  question: string;
  targetField: string;
  pageContext: string;
  relevantRecords: Array<{
    sectionId: string;
    itemIndex: number;
    fields: Record<string, string>;
  }>;
  mode: LongQuestionMode;
  maxInputChars: number;
  maxOutputChars: number;
}

export interface LongQuestionDraft {
  text: string;
  sourceRefs: Array<{
    sectionId: string;
    itemIndex: number;
    fieldKeys: string[];
  }>;
  missingFacts: string[];
  needsReview: true;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let rest = paragraph.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const boundary = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('；'),
      window.lastIndexOf(';'),
      window.lastIndexOf('！'),
      window.lastIndexOf('!'),
      window.lastIndexOf('？'),
      window.lastIndexOf('?'),
      window.lastIndexOf('，'),
      window.lastIndexOf(','),
    );
    const cut = boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function chunkLongQuestionContext(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const paragraphs = normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.flatMap((paragraph) => (
    paragraph.length <= limit ? [paragraph] : splitOversizedParagraph(paragraph, limit)
  ));
}

export function buildLongQuestionPrompt(request: LongQuestionRequest, contextChunk: string): string {
  const modeInstruction = request.mode === 'fast'
    ? '当前为 fast/快速模式：只进行一轮生成，不要额外总结；优先低延迟。'
    : '当前为 standard/标准模式：先在内部核对事实，再组织草稿；不要省略日期、数字、排名。';
  const records = request.relevantRecords.map((record) => ({
    sectionId: record.sectionId,
    itemIndex: record.itemIndex,
    fields: record.fields,
  }));
  return `你是保研报名材料的长文本草稿助手。\n${modeInstruction}\n\n` +
    `目标字段：${request.targetField}\n页面问题：${request.question}\n页面上下文：${request.pageContext}\n\n` +
    `相关资料（只能使用这些事实）：\n${JSON.stringify(records, null, 2)}\n\n` +
    `当前资料片段：\n${contextChunk}\n\n` +
    `严格要求：只能依据提供的资料写作，不得编造学校、项目、奖项、日期、排名、职务或成果；不确定的事实放入 missingFacts；保留原始日期、数字和排名；结果必须人工审核。\n` +
    `只返回 JSON 对象：{"text":"草稿","sourceRefs":[{"sectionId":"...","itemIndex":0,"fieldKeys":["..."]}],"missingFacts":["..."],"needsReview":true}`;
}

export function mergeLongQuestionDrafts(drafts: LongQuestionDraft[], maxOutputChars: number): LongQuestionDraft {
  const seen = new Set<string>();
  const textParts: string[] = [];
  const sourceRefMap = new Map<string, { sectionId: string; itemIndex: number; fieldKeys: string[] }>();
  const missingFacts: string[] = [];

  for (const draft of drafts) {
    const text = normalizeWhitespace(draft.text);
    if (text && !seen.has(text)) {
      seen.add(text);
      textParts.push(text);
    }
    for (const ref of draft.sourceRefs) {
      const key = `${ref.sectionId}:${ref.itemIndex}`;
      const previous = sourceRefMap.get(key);
      sourceRefMap.set(key, {
        sectionId: ref.sectionId,
        itemIndex: ref.itemIndex,
        fieldKeys: Array.from(new Set([...(previous?.fieldKeys ?? []), ...ref.fieldKeys])),
      });
    }
    for (const fact of draft.missingFacts.map((item) => item.trim()).filter(Boolean)) {
      if (!missingFacts.includes(fact)) missingFacts.push(fact);
    }
  }

  const max = Math.max(1, Math.floor(maxOutputChars));
  let text = textParts.join('\n');
  if (text.length > max) text = `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
  return {
    text,
    sourceRefs: [...sourceRefMap.values()],
    missingFacts,
    needsReview: true,
  };
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createLongQuestionCacheKey(request: LongQuestionRequest, profileVersion: string): string {
  return `long-question:v1:${stableHash(JSON.stringify({
    profileVersion,
    question: request.question.trim(),
    targetField: request.targetField.trim(),
    pageContext: request.pageContext.trim(),
    relevantRecords: request.relevantRecords,
    mode: request.mode,
    maxInputChars: request.maxInputChars,
    maxOutputChars: request.maxOutputChars,
  }))}`;
}
