import { getApiConfig, isApiConfigured, setApiConfig } from '@/utils/storage';
import {
  getAllCategories,
  getAllBlockCategories,
  getAllFileRecords,
  getAllTextFields,
  saveAllTextFields,
} from '@/utils/db';
import { isSemanticallyCompatibleMatch, matchFields, matchFieldsStream } from '@/utils/matcher';
import type { Category, FileRecord } from '@/utils/db';
import type { MatchResult, FormFieldInfo, MaterialRole } from '@/utils/matcher';
import { flattenProfileValues, getBlockSection, inferLanguageItems } from '@/utils/profile-schema';
import { getAiEligibleFields, isMeaningfullyFilled, matchFieldsLocally } from '@/utils/local-matcher';

interface MessageMap {
  inspectPage: undefined;
  startScan: undefined;
  startFill: { matches: MatchResult[] };
  manualFill: { value: string };
  markPageFields: {
    items: Array<{ index: number; status: 'verified' | 'review' | 'mismatch'; message?: string }>;
  };
  focusPageField: { index: number };
  startAutoRun: undefined;
  getAutoRunStatus: undefined;
  stopAutoRun: undefined;
}

type MessageType = keyof MessageMap;

type Request = {
  [T in MessageType]: {
    type: T;
    payload: MessageMap[T];
  };
}[MessageType];

interface ErrorResponse {
  ok: false;
  error: string;
}

interface ScanSuccessResponse {
  ok: true;
  type: 'scan';
  total: number;
  matched: number;
  matches: MatchResult[];
  fields: FormFieldInfo[];
  ai: {
    configured: boolean;
    mode: 'enhanced' | 'fallback';
    attempted: boolean;
    reviewed: number;
    error: string;
  };
}

interface FillSuccessResponse {
  ok: true;
  type: 'fill';
  success: number;
  failure: number;
}

interface InspectSuccessResponse {
  ok: true;
  type: 'inspect';
  total: number;
  required: number;
  unfilled: number;
  protected: number;
}

interface PageActionSuccessResponse {
  ok: true;
  type: 'pageAction';
}

type AutoRunStatus = 'running' | 'paused' | 'complete' | 'stopped';

interface AutoRunState {
  tabId: number;
  status: AutoRunStatus;
  pageCount: number;
  filledCount: number;
  message: string;
  updatedAt: number;
}

interface AutoRunSuccessResponse extends AutoRunState {
  ok: true;
  type: 'autoRun';
}

type Response = ScanSuccessResponse | FillSuccessResponse | InspectSuccessResponse | PageActionSuccessResponse | AutoRunSuccessResponse | ErrorResponse;

type ContentFillItem =
  | { kind: 'text'; index: number; value: string; confidence: MatchResult['confidence'] }
  | { kind: 'file'; index: number; fileName: string; fileType: string; fileBody: string };

interface RoleScore {
  role: MaterialRole;
  score: number;
  exact: boolean;
}

const autoRunInFlight = new Set<number>();

const MATERIAL_LABELS: Record<MaterialRole, string> = {
  id_photo: '证件照',
  id_card_front: '身份证正面',
  id_card_back: '身份证反面',
  transcript: '成绩单',
  ranking_proof: '排名证明',
  cet4_certificate: '四级成绩证明',
  cet6_certificate: '六级成绩证明',
  language_certificate: '外语成绩证明',
  award_certificate: '获奖证明',
  academic_proof: '学术成果证明',
  student_card: '学生证',
  recommendation_letter: '推荐信',
  enrollment_certificate: '在读证明',
  resume: '个人简历',
};

const ROLE_KEYWORDS: Record<MaterialRole, { exact: string[]; alias: string[] }> = {
  id_photo: {
    exact: ['证件照', '免冠照片', '免冠照', '个人照片', '报名照片'],
    alias: ['照片', '头像'],
  },
  id_card_front: {
    exact: ['身份证正面', '身份证人像面', '身份证头像面'],
    alias: ['人像面', '正面'],
  },
  id_card_back: {
    exact: ['身份证反面', '身份证国徽面'],
    alias: ['国徽面', '反面'],
  },
  transcript: {
    exact: ['本科成绩单', '成绩单', '学业成绩单'],
    alias: ['成绩证明', '学业成绩'],
  },
  ranking_proof: {
    exact: ['专业排名证明', '成绩排名证明', '排名证明'],
    alias: ['排名', '专业名次', '年级名次'],
  },
  cet4_certificate: {
    exact: ['英语四级成绩单', '四级成绩单', '英语四级证书', 'CET-4成绩单', 'CET4成绩单'],
    alias: ['英语四级', 'CET-4', 'CET4', '四级'],
  },
  cet6_certificate: {
    exact: ['英语六级成绩单', '六级成绩单', '英语六级证书', 'CET-6成绩单', 'CET6成绩单'],
    alias: ['英语六级', 'CET-6', 'CET6', '六级'],
  },
  language_certificate: {
    exact: ['外语成绩证明', '外语水平证明', '英语成绩证明', '雅思成绩单', '托福成绩单'],
    alias: ['外语', '英语成绩', '雅思', '托福'],
  },
  award_certificate: {
    exact: ['获奖证书', '奖励证明', '荣誉证书', '竞赛证书'],
    alias: ['获奖', '奖励', '荣誉', '竞赛'],
  },
  academic_proof: {
    exact: ['学术成果证明', '科研成果证明', '论文证明', '专利证书'],
    alias: ['论文', '专利', '科研成果', '学术成果'],
  },
  student_card: {
    exact: ['学生证', '学生证件'],
    alias: ['学生身份'],
  },
  recommendation_letter: {
    exact: ['专家推荐信', '专家推荐书', '推荐信'],
    alias: ['推荐材料', '推荐书'],
  },
  enrollment_certificate: {
    exact: ['在读证明', '学籍证明', '在校证明'],
    alias: ['在读', '学籍', '在校'],
  },
  resume: {
    exact: ['个人简历', '申请简历'],
    alias: ['简历', 'CV'],
  },
};

function errorResponse(error: string): ErrorResponse {
  return { ok: false, error };
}

function getRepeatRowTargets(
  blocks: Awaited<ReturnType<typeof getAllBlockCategories>>,
  textFields: Awaited<ReturnType<typeof getAllTextFields>>,
) {
  return blocks.flatMap((block) => {
    const section = getBlockSection(block);
    if (!section || section.kind !== 'repeat') return [];
    const inferredCount = section.id === 'language' ? inferLanguageItems(textFields).length : 0;
    const count = Math.max(block.items.length, inferredCount);
    return count > 0 ? [{ groupLabel: section.title, count }] : [];
  });
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function autoRunKey(tabId: number): string {
  return `autoRun:${tabId}`;
}

async function getAutoRunState(tabId: number): Promise<AutoRunState | null> {
  const result = await chrome.storage.session.get(autoRunKey(tabId));
  return (result[autoRunKey(tabId)] as AutoRunState | undefined) ?? null;
}

async function saveAutoRunState(state: AutoRunState): Promise<void> {
  state.updatedAt = Date.now();
  await chrome.storage.session.set({ [autoRunKey(state.tabId)]: state });
  const badge = state.status === 'running' ? '…' : state.status === 'paused' ? '!' : state.status === 'complete' ? '✓' : '';
  const color = state.status === 'paused' ? '#f59e0b' : state.status === 'complete' ? '#22c55e' : '#257ffd';
  await chrome.action.setBadgeBackgroundColor({ tabId: state.tabId, color }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId: state.tabId, text: badge }).catch(() => undefined);
}

function autoRunResponse(state: AutoRunState): AutoRunSuccessResponse {
  return { ok: true, type: 'autoRun', ...state };
}

async function sendToContentScript<T>(
  tabId: number,
  message: unknown,
  retryAfterInjection = true,
): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T;
  } catch (err) {
    if (!retryAfterInjection) throw err;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
  }
}

function normalizeMaterialText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function scoreRole(text: string, role: MaterialRole): RoleScore {
  const normalized = normalizeMaterialText(text);
  const keywords = ROLE_KEYWORDS[role];
  let score = 0;
  let exact = false;

  for (const keyword of keywords.exact) {
    if (normalized.includes(normalizeMaterialText(keyword))) {
      score += 10;
      exact = true;
    }
  }

  for (const keyword of keywords.alias) {
    if (normalized.includes(normalizeMaterialText(keyword))) {
      score += 3;
    }
  }

  if ((role === 'id_card_front' || role === 'id_card_back') && normalized.includes('身份证')) {
    score += 2;
  }
  if (role === 'id_photo' && normalized.includes('个人照片')) {
    score += 3;
  }

  return { role, score, exact };
}

function detectBestRole(text: string): RoleScore | null {
  const scores = (Object.keys(ROLE_KEYWORDS) as MaterialRole[])
    .map((role) => scoreRole(text, role))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return null;
  if (scores.length > 1 && scores[0].score === scores[1].score) return null;
  return scores[0];
}

function acceptsFile(accept: string | undefined, filename: string, fileType: string): boolean {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const lowerName = filename.toLowerCase();
  const lowerType = fileType.toLowerCase();
  return rules.some((rule) => {
    if (rule === '*/*') return true;
    if (rule.endsWith('/*')) return lowerType.startsWith(rule.slice(0, -1));
    if (rule.startsWith('.')) return lowerName.endsWith(rule);
    return lowerType === rule;
  });
}

function inferFileType(filename: string, fileType: string): string {
  if (fileType) return fileType;
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  if (/\.doc$/i.test(filename)) return 'application/msword';
  if (/\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return '';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function getCategoryName(record: FileRecord, categoryById: Map<number, Category>): string {
  return categoryById.get(record.categoryId)?.name ?? '';
}

function detectFileFieldRole(field: FormFieldInfo): RoleScore | null {
  const directRole = detectBestRole([
    field.label,
    field.hint,
    field.placeholder,
    field.ariaLabel,
    field.title,
    field.name,
    field.id,
  ].filter(Boolean).join(' '));
  if (directRole) return directRole;

  return detectBestRole([
    field.context,
    field.html,
  ].filter(Boolean).join(' '));
}

function matchFileFields(
  fields: FormFieldInfo[],
  fileRecords: FileRecord[],
  categories: Category[],
): MatchResult[] {
  const categoryById = new Map(categories.flatMap((category) => (
    category.id == null ? [] : [[category.id, category] as const]
  )));
  const fileFields = fields.filter((field) => field.kind === 'file');
  const availableRecords = fileRecords.filter((record) => record.id != null && record.fileBody.size > 0);

  return fileFields.flatMap((field) => {
    const fieldRole = detectFileFieldRole(field);
    if (!fieldRole) return [];

    const candidates = availableRecords
      .map((record) => {
        const text = [
          record.filename,
          record.fileDescription,
          getCategoryName(record, categoryById),
        ].filter(Boolean).join(' ');
        const materialRole = scoreRole(text, fieldRole.role);
        return { record, materialRole };
      })
      .filter(({ record, materialRole }) => (
        materialRole.score > 0 &&
        acceptsFile(field.accept, record.filename, inferFileType(record.filename, record.fileType))
      ))
      .sort((a, b) => (
        b.materialRole.score - a.materialRole.score ||
        b.record.createdAt - a.record.createdAt
      ));

    const best = candidates[0];
    if (!best?.record.id) return [];

    const confidence: MatchResult['confidence'] =
      fieldRole.exact && best.materialRole.exact
        ? 'high'
        : fieldRole.score >= 5 && best.materialRole.score >= 5
          ? 'medium'
          : 'low';

    return [{
      kind: 'file',
      index: field.index,
      fieldKey: fieldRole.role,
      value: best.record.filename,
      shortLabel: MATERIAL_LABELS[fieldRole.role],
      confidence,
      fileRecordId: best.record.id,
      fileName: best.record.filename,
      fileType: inferFileType(best.record.filename, best.record.fileType),
      materialRole: fieldRole.role,
      source: 'material',
    }];
  });
}

export default defineBackground(() => {
  if (import.meta.env.DEV) {
    seedDevData();
  }

  chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
    handleMessage(request)
      .then(sendResponse)
      .catch((err) => sendResponse(errorResponse(err.message)));

    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'stream-fill') return;
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'startStreamScan') {
        await handleStreamScan(port);
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    void getAutoRunState(tabId).then((state) => {
      if (state?.status === 'running') setTimeout(() => { void processAutoRun(tabId); }, 600);
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    autoRunInFlight.delete(tabId);
    void chrome.storage.session.remove(autoRunKey(tabId));
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'stream-fill') {
      console.log('%c⌨️ 快捷键触发流式填充', 'color:#6C5CE7;font-weight:bold');
      await handleStreamScan();
    }
  });
});

async function seedDevData() {
  const [textFields] = await Promise.all([
    getAllTextFields(),
    isApiConfigured(),
  ]);

  const devFields = [
    { key: '姓名', value: '' },
    { key: '手机号', value: '' },
    { key: '住址', value: '' },
    { key: '身份证号码', value: '' },
    { key: '出生日期', value: '' },
    { key: '民族', value: '' },
    { key: '性别', value: '' },
    { key: '婚否', value: '' },
    { key: '政治面貌', value: '' },
    { key: '户口所在地详细地址', value: '' },
    { key: '邮箱', value: '' },
  ];

  const existingKeys = new Set(textFields.map((field) => field.key));
  const missingFields = devFields.filter((field) => !existingKeys.has(field.key));
  if (missingFields.length > 0) {
    await saveAllTextFields([...textFields, ...missingFields]);
  }
}

async function handleMessage(request: Request): Promise<Response> {
  if (request.type === 'inspectPage') {
    return handleInspectPage();
  }
  if (request.type === 'startScan') {
    return handleScan();
  }
  if (request.type === 'startFill') {
    return handleFill(request.payload!.matches);
  }
  if (request.type === 'manualFill') {
    return handleManualFill(request.payload!.value);
  }
  if (request.type === 'markPageFields') {
    return handleMarkPageFields(request.payload!.items);
  }
  if (request.type === 'focusPageField') {
    return handleFocusPageField(request.payload!.index);
  }
  if (request.type === 'startAutoRun') {
    return handleStartAutoRun();
  }
  if (request.type === 'getAutoRunStatus') {
    return handleGetAutoRunStatus();
  }
  if (request.type === 'stopAutoRun') {
    return handleStopAutoRun();
  }
  return errorResponse('Unknown message type');
}

async function handleInspectPage(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const scanResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
    tab.id,
    { type: 'scan' },
  );
  const fields = (scanResults ?? []).map((result) => result.field);
  return {
    ok: true,
    type: 'inspect',
    total: fields.length,
    required: fields.filter((field) => field.required).length,
    unfilled: fields.filter((field) => !isMeaningfullyFilled(field)).length,
    protected: fields.filter((field) => field.protected).length,
  };
}

async function handleManualFill(value: string): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const result = await sendToContentScript<{ ok: boolean }>(tab.id, { type: 'manualFill', value });
  return result.ok
    ? { ok: true, type: 'fill', success: 1, failure: 0 }
    : { ok: true, type: 'fill', success: 0, failure: 1 };
}

async function handleMarkPageFields(
  items: Array<{ index: number; status: 'verified' | 'review' | 'mismatch'; message?: string }>,
): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  await sendToContentScript(tab.id, { type: 'markPreview', items });
  return { ok: true, type: 'pageAction' };
}

async function handleFocusPageField(index: number): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  await sendToContentScript(tab.id, { type: 'focusField', index });
  return { ok: true, type: 'pageAction' };
}

async function handleGetAutoRunStatus(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const state = await getAutoRunState(tab.id);
  return autoRunResponse(state ?? {
    tabId: tab.id,
    status: 'stopped',
    pageCount: 0,
    filledCount: 0,
    message: '尚未开始连续填写',
    updatedAt: Date.now(),
  });
}

async function handleStartAutoRun(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const previous = await getAutoRunState(tab.id);
  const state: AutoRunState = {
    tabId: tab.id,
    status: 'running',
    pageCount: previous?.status === 'paused' ? previous.pageCount : 0,
    filledCount: previous?.status === 'paused' ? previous.filledCount : 0,
    message: '后台正在填写当前页面',
    updatedAt: Date.now(),
  };
  await saveAutoRunState(state);
  void processAutoRun(tab.id);
  return autoRunResponse(state);
}

async function handleStopAutoRun(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  const previous = await getAutoRunState(tab.id);
  const state: AutoRunState = {
    tabId: tab.id,
    status: 'stopped',
    pageCount: previous?.pageCount ?? 0,
    filledCount: previous?.filledCount ?? 0,
    message: '已停止连续填写',
    updatedAt: Date.now(),
  };
  await saveAutoRunState(state);
  return autoRunResponse(state);
}

async function collectTabScan(tabId: number, allowAi = true): Promise<ScanSuccessResponse> {
  const [textFields, blocks, apiConfig, textApiReady, fileRecords, categories] = await Promise.all([
    getAllTextFields(),
    getAllBlockCategories(),
    getApiConfig(),
    isApiConfigured(),
    getAllFileRecords(),
    getAllCategories(),
  ]);
  await sendToContentScript(tabId, {
    type: 'prepareRepeatRows',
    targets: getRepeatRowTargets(blocks, textFields),
  });

  const scanResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
    tabId,
    { type: 'scan' },
  );
  if (!scanResults?.length) {
    return {
      ok: true,
      type: 'scan',
      total: 0,
      matched: 0,
      matches: [],
      fields: [],
      ai: {
        configured: textApiReady,
        mode: apiConfig.aiEnhanced ? 'enhanced' : 'fallback',
        attempted: false,
        reviewed: 0,
        error: '',
      },
    };
  }

  const fieldInfos = scanResults.map((result) => ({ ...result.field, index: result.index }));
  const textFieldInfos = fieldInfos.filter((field) => field.kind !== 'file');
  const localMatches = matchFieldsLocally(textFieldInfos, textFields, blocks);
  const aiFields = apiConfig.aiEnhanced
    ? textFieldInfos.filter((field) => !field.protected || /只读|锁定/.test(field.protectionReason ?? ''))
    : getAiEligibleFields(textFieldInfos, localMatches);
  const profileValues = flattenProfileValues(textFields, blocks);
  let aiMatches: MatchResult[] = [];
  let aiError = '';
  let aiAttempted = false;
  if (allowAi && textApiReady && aiFields.length > 0 && profileValues.length > 0) {
    aiAttempted = true;
    try {
      aiMatches = await matchFields(aiFields, apiConfig, profileValues.map(({ key, value }) => ({ key, value })));
    } catch (error) {
      aiMatches = [];
      aiError = (error instanceof Error ? error.message : 'API 调用失败').replace(/\s+/g, ' ').slice(0, 180);
    }
  }
  const fileMatches = matchFileFields(fieldInfos, fileRecords, categories);
  const aiByIndex = new Map(aiMatches.map((match) => [match.index, match]));
  const localByIndex = new Map(localMatches.map((match) => [match.index, match]));
  const reviewedMatches = localMatches.map((localMatch) => {
    const aiMatch = aiByIndex.get(localMatch.index);
    if (!aiMatch) return localMatch;
    if (localMatch.confidence === 'medium' && aiMatch.confidence === 'high') return aiMatch;
    return { ...localMatch, source: 'ai_reviewed' as const };
  });
  const aiOnlyMatches = aiMatches.filter((match) => !localByIndex.has(match.index));
  const matches = [...reviewedMatches, ...aiOnlyMatches, ...fileMatches];
  return {
    ok: true,
    type: 'scan',
    total: fieldInfos.length,
    matched: matches.length,
    matches,
    fields: fieldInfos,
    ai: {
      configured: textApiReady,
      mode: apiConfig.aiEnhanced ? 'enhanced' : 'fallback',
      attempted: aiAttempted,
      reviewed: aiMatches.length,
      error: aiError,
    },
  };
}

async function handleScan(): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');
  return collectTabScan(tab.id);
}

async function handleFill(
  matches: MatchResult[],
): Promise<Response> {
  const tab = await getCurrentTab();
  if (!tab?.id) return errorResponse('No active tab found');

  const fileMatches = matches.filter((match) => match.kind === 'file' && match.fileRecordId != null);
  const fileRecordById = new Map<number, FileRecord>();
  if (fileMatches.length > 0) {
    const records = await getAllFileRecords();
    for (const record of records) {
      if (record.id != null) fileRecordById.set(record.id, record);
    }
  }

  const items: ContentFillItem[] = [];
  for (const match of matches) {
    if (match.kind === 'file') {
      if (match.fileRecordId == null) continue;
      const record = fileRecordById.get(match.fileRecordId);
      if (!record) continue;
      items.push({
        kind: 'file',
        index: match.index,
        fileName: record.filename,
        fileType: inferFileType(record.filename, record.fileType),
        fileBody: arrayBufferToBase64(await record.fileBody.arrayBuffer()),
      });
    } else {
      items.push({ kind: 'text', index: match.index, value: match.value, confidence: match.confidence });
    }
  }

  const result = await sendToContentScript<{ success: number; failure: number }>(
    tab.id,
    { type: 'fill', items },
  );

  return { ok: true, type: 'fill', success: result.success, failure: result.failure };
}

async function processAutoRun(tabId: number): Promise<void> {
  if (autoRunInFlight.has(tabId)) return;
  autoRunInFlight.add(tabId);
  try {
    const state = await getAutoRunState(tabId);
    if (!state || state.status !== 'running') return;
    if (state.pageCount >= 20) {
      state.status = 'paused';
      state.message = '已连续处理 20 页，为避免误操作已暂停，请人工检查';
      await saveAutoRunState(state);
      return;
    }

    state.message = `正在处理第 ${state.pageCount + 1} 页`;
    await saveAutoRunState(state);
    if (state.pageCount > 0) {
      // Full navigations may report complete just before the new content script
      // has finished its first DOM pass. Give the page a short settling window.
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    let scan = await collectTabScan(tabId);
    if (scan.total === 0 && state.pageCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      scan = await collectTabScan(tabId);
    }
    const scannedFieldByIndex = new Map(scan.fields.map((field) => [field.index, field]));
    const selectedMatches = scan.matches.filter((match) => (
      match.kind !== 'file' &&
      match.confidence !== 'low' &&
      !isMeaningfullyFilled(scannedFieldByIndex.get(match.index) ?? ({} as FormFieldInfo))
    ));
    const result = await sendToContentScript<{ success: number; failure: number }>(tabId, {
      type: 'fill',
      items: selectedMatches.map((match) => ({
        kind: 'text',
        index: match.index,
        value: match.value,
        confidence: match.confidence,
      })),
    });
    state.filledCount += result.success;

    const afterResults = await sendToContentScript<Array<{ index: number; field: FormFieldInfo }>>(
      tabId,
      { type: 'scan' },
    );
    const blockers = (afterResults ?? [])
      .map((resultItem) => ({ ...resultItem.field, index: resultItem.index }))
      .filter((field) => field.required && !isMeaningfullyFilled(field));
    if (blockers.length > 0) {
      const labels = blockers.slice(0, 3).map((field) => field.label || field.columnLabel || `字段${field.index + 1}`);
      state.status = 'paused';
      state.message = `本页还有 ${blockers.length} 个必填项需处理：${labels.join('、')}`;
      await saveAutoRunState(state);
      return;
    }

    state.message = '本页填写完成，正在安全进入下一步';
    await saveAutoRunState(state);
    let advance: { clicked: boolean; advanced: boolean; reason: string };
    try {
      // Never replay a navigation command after its message channel disconnects:
      // the disconnect usually means the first click already opened the next page.
      advance = await sendToContentScript(tabId, { type: 'advanceToNextStep' }, false);
    } catch {
      // A full-page navigation destroys the old content-script message channel.
      // The disconnect can arrive after the new tab already reports "complete",
      // so tab.status alone is not a reliable navigation signal.
      state.pageCount++;
      state.message = '页面切换中，后台会在新页面稳定后继续填写';
      await saveAutoRunState(state);
      setTimeout(() => { void processAutoRun(tabId); }, 700);
      return;
    }

    if (!advance.clicked) {
      state.pageCount++;
      state.status = 'complete';
      state.message = '已到最终审核页，未执行提交，请逐项核对后本人决定';
      await saveAutoRunState(state);
      return;
    }
    if (!advance.advanced) {
      state.status = 'paused';
      state.message = advance.reason;
      await saveAutoRunState(state);
      return;
    }

    state.pageCount++;
    state.message = '已进入下一页，后台继续填写';
    await saveAutoRunState(state);
    setTimeout(() => { void processAutoRun(tabId); }, 250);
  } catch (error) {
    const state = await getAutoRunState(tabId);
    if (state?.status === 'running') {
      state.status = 'paused';
      state.message = error instanceof Error ? error.message : '连续填写遇到错误，已暂停';
      await saveAutoRunState(state);
    }
  } finally {
    autoRunInFlight.delete(tabId);
  }
}

async function handleStreamScan(port?: chrome.runtime.Port): Promise<void> {
  const tab = await getCurrentTab();
  if (!tab?.id) {
    port?.postMessage({ type: 'streamError', error: 'No active tab found' });
    port?.disconnect();
    return;
  }

  const sendProgress = (matched: number, total: number, latestLabel: string) => {
    port?.postMessage({ type: 'streamProgress', matched, total, latestLabel });
  };

  try {
    // 1. Load data and safely add missing visible rows in recognized repeat tables
    const [textFields, blocks, apiConfig, textApiReady] = await Promise.all([
      getAllTextFields(),
      getAllBlockCategories(),
      getApiConfig(),
      isApiConfigured(),
    ]);
    await sendToContentScript(tab.id, {
      type: 'prepareRepeatRows',
      targets: getRepeatRowTargets(blocks, textFields),
    });

    // 2. Scan fields
    const scanResults = await sendToContentScript<
      Array<{ index: number; field: FormFieldInfo }>
    >(tab.id, { type: 'scan' });

    if (!scanResults || scanResults.length === 0) {
      port?.postMessage({ type: 'streamComplete', matched: 0, errorCount: 0 });
      port?.disconnect();
      return;
    }

    const fieldInfos = scanResults.map((r) => ({ ...r.field, index: r.index }));
    const textFieldInfos = fieldInfos.filter((f) => f.kind !== 'file');
    const totalFields = fieldInfos.length;

    let matched = 0;
    let errorCount = 0;

    // 3. Init content script for streaming
    await sendToContentScript(tab.id, {
      type: 'fillStreamInit',
      items: fieldInfos.map((f) => ({ index: f.index, fillMode: f.fillMode ?? 'short' })),
    });

    // 4. Local deterministic matches (AI is optional)
    const localMatches = matchFieldsLocally(textFieldInfos, textFields, blocks);
    for (const match of localMatches) {
      const field = textFieldInfos.find((candidate) => candidate.index === match.index);
      if (field && isMeaningfullyFilled(field)) continue;
      try {
        await sendToContentScript(tab.id, {
          type: 'fillField',
          index: match.index,
          value: match.value,
          confidence: match.confidence,
        });
        matched++;
        sendProgress(matched, totalFields, match.shortLabel);
      } catch { errorCount++; }
    }

    // 5. Stream text matches
    const aiFields = getAiEligibleFields(textFieldInfos, localMatches);
    const profileValues = flattenProfileValues(textFields, blocks);
    const profileValueByKey = new Map(profileValues.map((value) => [value.key, value.value]));
    const fieldByIndex = new Map(textFieldInfos.map((field) => [field.index, field]));
    if (textApiReady && aiFields.length > 0 && profileValues.length > 0) {
      for await (const event of matchFieldsStream(aiFields, apiConfig, profileValues.map(({ key, value }) => ({ key, value })))) {
        if (event.type === 'value_chunk') {
          try {
            await sendToContentScript(tab.id, {
              type: 'fillTypeChunk',
              index: event.index,
              chunk: event.chunk,
            });
          } catch { /* tab may have closed */ }
        } else if (event.type === 'match_complete') {
          const match = event.match;
          const field = fieldByIndex.get(match.index);
          if (!isSemanticallyCompatibleMatch(field, match.fieldKey)) continue;
          if (field?.rowIndex != null && field.groupLabel) {
            const structuredPrefix = `${field.groupLabel}[${field.rowIndex + 1}].`;
            const groundedValue = match.fieldKey.startsWith(structuredPrefix)
              ? profileValueByKey.get(match.fieldKey)
              : undefined;
            if (groundedValue == null) continue;
            match.value = groundedValue;
          }
          try {
            if (match.fillMode === 'long') {
              await sendToContentScript(tab.id, {
                type: 'fillTypeCommit',
                index: match.index,
              });
            } else {
              await sendToContentScript(tab.id, {
                type: 'fillField',
                index: match.index,
                value: match.value,
                confidence: match.confidence,
              });
            }
            matched++;
            sendProgress(matched, totalFields, match.shortLabel);
          } catch { errorCount++; }
        }
      }
    }

    // 6. Complete
    try {
      await sendToContentScript(tab.id, { type: 'fillStreamComplete' });
    } catch { /* ignore */ }
    port?.postMessage({ type: 'streamComplete', matched, errorCount });
  } catch (err) {
    port?.postMessage({ type: 'streamError', error: (err as Error).message });
  } finally {
    port?.disconnect();
  }
}
