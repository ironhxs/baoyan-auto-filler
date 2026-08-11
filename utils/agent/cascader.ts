export interface CascaderAgentObservation {
  field: {
    label: string;
    hint: string;
    controlType: 'cascader';
  };
  target: string;
  level: number;
  selectedPath: string[];
  visibleOptions: string[];
}

export interface CascaderAgentDecision {
  action: 'select_visible_option';
  value: string;
  confidence: number;
  reason: string;
}

export interface CascaderPathCacheScope {
  pageUrl: string;
  fieldIdentity: string;
  target: string;
  firstLevelOptions: string[];
}

export interface CascaderPathCacheEntry {
  version: 1;
  cacheKey: string;
  pageUrl: string;
  fieldIdentity: string;
  target: string;
  structureSignature: string;
  path: string[];
  verifiedAt: number;
}

const MAX_VISIBLE_OPTIONS = 80;
const MAX_OPTION_LENGTH = 160;
const MAX_PATH_LENGTH = 12;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function normalizeOptionAlias(value: string): string {
  return normalizeText(value)
    .replace(/^\d{4,12}\s*/u, '')
    .replace(/[|/>\\、,，;；\s-]+/gu, '')
    .toLowerCase();
}

function safeOptions(values: string[]): string[] {
  return [...new Set(values
    .map((value) => normalizeText(value).slice(0, MAX_OPTION_LENGTH))
    .filter(Boolean))]
    .slice(0, MAX_VISIBLE_OPTIONS);
}

function safePath(values: string[]): string[] {
  return values
    .map((value) => normalizeText(value).slice(0, MAX_OPTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PATH_LENGTH);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeCascaderPageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function buildCascaderStructureSignature(options: string[]): string {
  return stableHash(JSON.stringify(safeOptions(options).map(normalizeOptionAlias)));
}

export function createCascaderPathCacheKey(scope: CascaderPathCacheScope): string {
  const identity = {
    pageUrl: sanitizeCascaderPageUrl(scope.pageUrl),
    fieldIdentity: normalizeText(scope.fieldIdentity).slice(0, 500),
    target: normalizeOptionAlias(scope.target),
  };
  return `baotian:cascader:path:v1:${stableHash(JSON.stringify(identity))}`;
}

export function createCascaderPathCacheEntry(
  scope: CascaderPathCacheScope,
  path: string[],
  verifiedAt = Date.now(),
): CascaderPathCacheEntry {
  return {
    version: 1,
    cacheKey: createCascaderPathCacheKey(scope),
    pageUrl: sanitizeCascaderPageUrl(scope.pageUrl),
    fieldIdentity: normalizeText(scope.fieldIdentity).slice(0, 500),
    target: normalizeText(scope.target).slice(0, MAX_OPTION_LENGTH),
    structureSignature: buildCascaderStructureSignature(scope.firstLevelOptions),
    path: safePath(path),
    verifiedAt,
  };
}

export function validateCascaderPathCacheEntry(
  entry: CascaderPathCacheEntry | null | undefined,
  scope: CascaderPathCacheScope,
  now = Date.now(),
): string[] | null {
  if (!entry || entry.version !== 1) return null;
  if (entry.cacheKey !== createCascaderPathCacheKey(scope)) return null;
  if (entry.pageUrl !== sanitizeCascaderPageUrl(scope.pageUrl)) return null;
  if (entry.fieldIdentity !== normalizeText(scope.fieldIdentity).slice(0, 500)) return null;
  if (normalizeOptionAlias(entry.target) !== normalizeOptionAlias(scope.target)) return null;
  if (entry.structureSignature !== buildCascaderStructureSignature(scope.firstLevelOptions)) return null;
  if (!Number.isFinite(entry.verifiedAt) || now - entry.verifiedAt > CACHE_TTL_MS || entry.verifiedAt > now + 60_000) {
    return null;
  }
  const path = safePath(entry.path);
  if (path.length === 0 || path.length !== entry.path.length) return null;
  const firstMatches = safeOptions(scope.firstLevelOptions)
    .filter((option) => normalizeOptionAlias(option) === normalizeOptionAlias(path[0]));
  return firstMatches.length === 1 ? path : null;
}

export function buildCascaderAgentPrompt(observation: CascaderAgentObservation): string {
  const options = safeOptions(observation.visibleOptions);
  const selectedPath = safeOptions(observation.selectedPath).slice(0, MAX_PATH_LENGTH);
  const payload = {
    field: {
      label: normalizeText(observation.field.label).slice(0, 300),
      hint: normalizeText(observation.field.hint).slice(0, 800),
      controlType: 'cascader',
    },
    target: normalizeText(observation.target).slice(0, MAX_OPTION_LENGTH),
    level: Math.max(0, Math.min(12, Math.floor(observation.level) || 0)),
    selectedPath,
    visibleOptions: options,
  };
  return `你是保研报名表单的受约束级联选择助手。页面执行器正在填写一个动态级联控件。

规则：
- 只能从 visibleOptions 中选择一个下一步选项，必须返回页面当前真实显示的标签。
- 不得返回脚本、选择器、坐标、网页按钮或 visibleOptions 之外的内容。
- 根据字段题目、说明、目标值和已选路径判断；例如院校末级目标可能需要先选择所在省份。
- 无法可靠判断时返回 manual_review，禁止猜测。
- 只返回一个 JSON 对象，不要 Markdown：
  {"action":"select_visible_option","value":"候选原文","confidence":0到1,"reason":"简短理由"}
  或 {"action":"manual_review","value":"","confidence":0,"reason":"简短理由"}

观察：
${JSON.stringify(payload, null, 2)}`;
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : null;
}

function resolveVisibleOption(value: string, visibleOptions: string[]): string | null {
  const exact = visibleOptions.filter((option) => option === value);
  if (exact.length === 1) return exact[0];
  const alias = normalizeOptionAlias(value);
  if (!alias) return null;
  const equivalent = visibleOptions.filter((option) => normalizeOptionAlias(option) === alias);
  return equivalent.length === 1 ? equivalent[0] : null;
}

export function parseAndValidateCascaderAgentDecision(
  responseText: string,
  observation: CascaderAgentObservation,
): CascaderAgentDecision | null {
  const json = extractJsonObject(responseText);
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (raw.action !== 'select_visible_option') return null;
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.6 || confidence > 1) return null;
  const visibleOptions = safeOptions(observation.visibleOptions);
  const selected = resolveVisibleOption(normalizeText(raw.value), visibleOptions);
  if (!selected) return null;
  return {
    action: 'select_visible_option',
    value: selected,
    confidence,
    reason: normalizeText(raw.reason).slice(0, 240),
  };
}

export async function requestCascaderAgentDecision(
  observation: CascaderAgentObservation,
  requestText: (prompt: string) => Promise<string>,
): Promise<CascaderAgentDecision | null> {
  if (safeOptions(observation.visibleOptions).length === 0) return null;
  const response = await requestText(buildCascaderAgentPrompt(observation));
  return parseAndValidateCascaderAgentDecision(response, observation);
}
