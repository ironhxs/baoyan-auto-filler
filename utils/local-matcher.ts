import type { BlockCategory, TextField } from './db';
import type { FormFieldInfo, MatchResult } from './matcher';
import { getBlockSection, inferLanguageItems } from './profile-schema';
import { projectProfileToTargetSchema, type ProfileProjectionCandidate } from './profile-projections';
import { getFieldItemBinding, planRepeatableRecords, type RepeatableRecordPlan } from './repeatable-records';

const ALIAS_GROUPS: string[][] = [
  ['姓名', '成员姓名', '家庭成员姓名', '真实姓名'],
  ['手机号', '手机号码', '联系电话', '联系方式', '移动电话', '本人电话'],
  ['邮箱', '电子邮箱', '电子邮件', 'email', 'e-mail'],
  ['身份证号码', '身份证号', '证件号码', '证件号'],
  ['出生日期', '出生年月日', '生日'],
  ['性别'],
  ['民族'],
  ['政治面貌'],
  ['婚否', '婚姻状况'],
  ['住址', '家庭住址', '现住址', '居住地址'],
  ['通讯地址', '通迅地址', '通信地址', '联系地址', '邮寄地址'],
  ['通信地址邮政编码', '通讯地址邮政编码', '邮政编码', '邮编'],
  ['出生地'],
  ['籍贯地', '籍贯'],
  ['户口所在地详细地址', '户籍地址', '户口所在地', '户籍所在地'],
  ['档案所在单位', '档案保管单位'],
  ['档案所在单位地址', '档案单位地址'],
  ['档案所在单位邮政编码', '档案单位邮编'],
  ['紧急电话', '紧急联系电话'],
  ['固定电话', '座机', '住宅电话', '办公电话'],
  ['关系', '与本人关系', '称谓', '家庭关系'],
  ['工作单位及职务', '在何单位工作任何职务', '工作单位和职务', '单位及职务', '工作单位职务'],
  ['学校', '就读学校', '本科院校', '毕业院校'],
  ['院系', '学院', '所在学院', '所在院系'],
  ['专业', '本科专业', '所学专业'],
  ['学号'],
  ['预计毕业年月', '毕业时间', '预计毕业时间'],
  ['入学年月', '入学时间', '本科入学年月'],
  ['GPA', '平均绩点', '绩点'],
  ['综合排名', '成绩排名', '专业排名', '年级排名', '排名'],
  ['排名基数', '专业人数', '年级人数', '总人数'],
  ['预计能否获得推免资格', '是否获得推免资格', '推免资格'],
  ['英语四级成绩', '四级成绩', 'CET4', 'CET-4'],
  ['英语六级成绩', '六级成绩', 'CET6', 'CET-6'],
  ['外语考试成绩', '外语成绩'],
  ['考试名称', '外语水平', '外语等级', '考试类型'],
  ['成绩', '考试成绩', '外语分数'],
  ['考试日期', '取得成绩时间', '取得时间', '考试时间'],
  ['备注', '说明'],
  ['证书编号', '成绩单编号'],
  ['辅导员姓名'],
  ['辅导员电话', '辅导员联系方式'],
  ['是否来自拔尖人才培养基地', '是否拔尖人才培养基地', '是否来自拔尖基地'],
  ['拔尖人才培养基地名称', '拔尖基地名称'],
  ['起止时间', '项目时间段', '时间段', '开始日期', '结束日期', '开始时间', '结束时间'],
  ['研究项目名称', '科研项目名称', '项目名称'],
  ['实习实践单位', '实践单位', '实习单位', '所在单位'],
  ['社会工作名称', '社会工作', '职务名称'],
  ['主要工作内容', '项目描述', '经历说明', '主要经历', '经历内容', '描述'],
  ['本人角色', '角色', '本人职务'],
  ['作者', '论文作者', '作者姓名'],
  ['论文标题', '论文名称', '论文题目'],
  ['刊物/会议名称', '刊物名称', '会议名称', '发表刊物'],
  ['发表时间', '发表/接收年月', '发表或完成时间', '完成时间'],
  ['论文类型', '成果类型', '成果类别'],
  ['发表状态', '论文发表状态', '出版状态'],
  ['分区', '期刊分区', 'SCI分区'],
  ['专利权人', '专利人', '发明人'],
  ['专利名称', '专利标题'],
  ['授权或受理时间', '专利时间', '受理时间', '授权时间'],
  ['获奖人', '获奖者', '获奖人员'],
  ['获奖项目名称', '获奖项目', '项目成果名称'],
  ['竞赛名称', '比赛名称', '赛事名称'],
  ['获奖名称', '奖项名称', '奖励名称', '荣誉名称'],
  ['获奖等级', '奖项等级', '奖励级别', '获奖级别', '奖项级别', '竞赛级别'],
  ['获奖时间', '奖励时间', '获奖日期', '奖励日期'],
  ['本人排名', '获奖排名', '作者排名', '署名顺序'],
  ['主办单位', '颁发单位', '授予单位', '组织单位'],
  ['描述', '成果说明', '成果简介'],
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/cet[-\s]?4/g, '英语四级')
    .replace(/cet[-\s]?6/g, '英语六级')
    .replace(/获奖|奖项|竞赛|比赛|荣誉/g, '奖励')
    .replace(/等级/g, '级别')
    .replace(/请(输入|填写|选择)|您的|主要|详细|信息|情况/g, '')
    .replace(/[\s　：:，,。；;（）()【】\[\]\/|｜_*#]/g, '');
}

function aliasesFor(key: string): string[] {
  const normalizedKey = normalize(key);
  return ALIAS_GROUPS.find((group) => group.some((alias) => normalize(alias) === normalizedKey)) ?? [key];
}

function scoreKey(fieldText: string, key: string): number {
  const normalizedField = normalize(fieldText);
  if (!normalizedField) return 0;

  let score = 0;
  for (const alias of aliasesFor(key)) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;
    if (normalizedField === normalizedAlias) score = Math.max(score, 100);
    else if (normalizedField.startsWith(normalizedAlias) || normalizedField.endsWith(normalizedAlias)) {
      score = Math.max(score, 88 + Math.min(6, normalizedAlias.length));
    } else if (normalizedField.includes(normalizedAlias)) {
      score = Math.max(score, 76 + Math.min(8, normalizedAlias.length));
    }
  }
  return score;
}

function fieldSemanticText(field: FormFieldInfo): string {
  return [
    field.columnLabel,
    field.label,
    field.placeholder,
    field.ariaLabel,
    field.title,
    field.hint,
    field.name,
    field.id,
  ].filter(Boolean).join(' | ');
}

function primaryFieldSemanticText(field: FormFieldInfo): string {
  return [
    field.columnLabel,
    field.label,
    field.placeholder,
    field.ariaLabel,
    field.title,
    field.name,
    field.id,
  ].find((value) => value?.trim()) ?? '';
}

function rankedCandidates(semanticText: string, textFields: TextField[]) {
  return textFields
    .filter((source) => source.value.trim() && !/^(字段值|待填写|请填写|未填写)$/i.test(source.value.trim()))
    .map((source) => ({ source, score: scoreKey(semanticText, source.key) }))
    .filter(({ score }) => score >= 76)
    .sort((a, b) => b.score - a.score);
}

function chooseUnambiguousCandidate(candidates: ReturnType<typeof rankedCandidates>) {
  const best = candidates[0];
  if (!best) return undefined;
  if (candidates[1] && candidates[1].score === best.score && candidates[1].source.key !== best.source.key) {
    return undefined;
  }
  return best;
}

export function isMeaningfullyFilled(field: FormFieldInfo): boolean {
  const value = (field.value ?? '').trim();
  if (!value) return false;
  const placeholder = value.replace(/[-—–_\s]/g, '');
  if (/^(请选择|请选择一项|请选|无|未选择|select)$/i.test(placeholder)) return false;
  const firstOption = field.options?.[0]?.trim();
  if (firstOption === value && /请选择|请选|select|^-+$/i.test(firstOption)) return false;
  return true;
}

function adaptValueToOptions(value: string, options: string[] | undefined): string {
  if (!options?.length) return value;
  const normalizedValue = normalize(value);
  const exact = options.find((option) => normalize(option) === normalizedValue);
  if (exact) return exact;
  const close = options.find((option) => normalize(option).includes(normalizedValue) || normalizedValue.includes(normalize(option)));
  return close ?? value;
}

export function adaptValueToField(value: string, field: FormFieldInfo): string {
  const optionValue = adaptValueToOptions(value, field.options);
  const semantic = fieldSemanticText(field);
  const datePattern = field.dateFormat || field.html?.match(/dateFmt\s*:\s*['"]([^'"]+)['"]/i)?.[1];
  const parts = optionValue.match(/((?:19|20)\d{2})\D{0,3}(\d{1,2})(?:\D{0,3}(\d{1,2}))?/);
  if (datePattern && parts) {
    const [, year, rawMonth, rawDay] = parts;
    const month = rawMonth.padStart(2, '0');
    const day = (rawDay ?? '1').padStart(2, '0');
    return datePattern
      .replace(/yyyy/g, year)
      .replace(/MM/g, month)
      .replace(/dd/g, day)
      .replace(/M/g, String(Number(rawMonth)))
      .replace(/d/g, String(Number(rawDay ?? '1')));
  }
  if (/年月|入学|毕业/.test(semantic) && /^\d{6}$/.test((field.value ?? '').trim()) && parts) {
    return `${parts[1]}${parts[2].padStart(2, '0')}`;
  }
  if (/出生日期|年月日/.test(semantic) && /^\d{8}$/.test((field.value ?? '').trim()) && parts?.[3]) {
    return `${parts[1]}${parts[2].padStart(2, '0')}${parts[3].padStart(2, '0')}`;
  }
  return optionValue;
}

function makeMatch(
  field: FormFieldInfo,
  sourceKey: string,
  sourceFieldKey: string,
  value: string,
  score: number,
): MatchResult {
  const rowLabel = field.rowIndex != null ? `第${field.rowIndex + 1}行` : '';
  const label = [field.groupLabel, rowLabel, field.columnLabel || field.label || sourceFieldKey].filter(Boolean).join('·');
  return {
    kind: 'text',
    index: field.index,
    fieldKey: sourceKey,
    value: adaptValueToField(value, field),
    shortLabel: label || sourceFieldKey,
    confidence: score >= 88 ? 'high' : 'medium',
    fillMode: field.fillMode,
    source: 'local',
  };
}

function findStructuredMatch(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
  plan: RepeatableRecordPlan,
): MatchResult | undefined {
  if (field.rowIndex == null || !field.groupLabel) return undefined;
  const block = blocks.find((candidate) => {
    const section = getBlockSection(candidate);
    return section?.title === field.groupLabel || normalize(candidate.title) === normalize(field.groupLabel ?? '');
  });
  if (!block && field.groupLabel !== '外语水平') return findProjectedStructuredMatch(field, blocks, textFields);
  const itemIndex = getFieldItemBinding(field, plan);
  if (itemIndex == null) return undefined;
  const inferredLanguageItems = field.groupLabel === '外语水平' ? inferLanguageItems(textFields) : [];
  const item = block?.items[itemIndex] ?? inferredLanguageItems[itemIndex];
  if (!item) return undefined;
  const blockTitle = block?.title ?? field.groupLabel;

  const semanticText = field.columnLabel || field.label || fieldSemanticText(field);
  const candidates = item.fields
    .map((source) => ({ source, score: scoreKey(semanticText, source.key) }))
    .filter(({ score }) => score >= 76)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || !best.source.value.trim()) return undefined;

  return makeMatch(
    field,
    `${blockTitle}[${itemIndex + 1}].${best.source.key}`,
    best.source.key,
    best.source.value,
    best.score,
  );
}

function findBlockForGroup(field: FormFieldInfo, blocks: BlockCategory[]): BlockCategory | undefined {
  if (!field.groupLabel) return undefined;
  return blocks.find((candidate) => {
    const section = getBlockSection(candidate);
    return section?.title === field.groupLabel || normalize(candidate.title) === normalize(field.groupLabel ?? '');
  });
}

function projectedRecordKey(candidate: ProfileProjectionCandidate): string {
  return `${candidate.sourceSectionId}:${candidate.sourceItemIndex}`;
}

function projectedCandidatesForField(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
  targetFieldKeys: string[],
): ProfileProjectionCandidate[] {
  if (!field.groupLabel) return [];
  return projectProfileToTargetSchema({
    groupLabel: field.groupLabel,
    fields: targetFieldKeys.map((key) => ({ key, label: key })),
  }, blocks, textFields);
}

function findProjectedStructuredMatch(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
): MatchResult | undefined {
  if (field.rowIndex == null || !field.groupLabel) return undefined;
  const targetKey = field.columnLabel || field.label || field.placeholder || '';
  if (!targetKey.trim()) return undefined;
  const candidates = projectedCandidatesForField(field, blocks, textFields, [targetKey]);
  const recordOrder: string[] = [];
  const byRecord = new Map<string, ProfileProjectionCandidate>();
  for (const candidate of candidates) {
    const key = projectedRecordKey(candidate);
    if (!byRecord.has(key)) recordOrder.push(key);
    byRecord.set(key, candidate);
  }
  const candidate = byRecord.get(recordOrder[field.rowIndex]);
  if (!candidate) return undefined;
  return {
    kind: 'text',
    index: field.index,
    fieldKey: `${field.groupLabel}[${field.rowIndex + 1}].${candidate.sourceFieldKeys[0]}`,
    value: adaptValueToField(candidate.value, field),
    shortLabel: `${field.groupLabel}·第${field.rowIndex + 1}行·${targetKey}`,
    confidence: candidate.confidence >= 0.95 ? 'high' : 'medium',
    fillMode: field.fillMode,
    source: 'local',
  };
}

function findProjectedAggregateMatch(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
): MatchResult | undefined {
  if (field.rowIndex != null || !field.groupLabel || field.fillMode !== 'long') return undefined;
  const sourceBlocks = blocks.filter((block) => [
    'education_career', 'research_training', 'internship_practice', 'social_work', 'published_papers',
    'granted_patents', 'subject_competitions', 'honors_awards',
  ].includes(block.sectionId ?? ''));
  const targetFieldKeys = Array.from(new Set(sourceBlocks.flatMap((block) => [
    ...(block.templateFields ?? []),
    ...block.items.flatMap((item) => item.fields.map((source) => source.key)),
  ]).filter(Boolean)));
  if (!targetFieldKeys.length) return undefined;
  const candidates = projectedCandidatesForField(field, blocks, textFields, targetFieldKeys);
  const byRecord = new Map<string, ProfileProjectionCandidate[]>();
  for (const candidate of candidates) {
    const key = projectedRecordKey(candidate);
    const existing = byRecord.get(key) ?? [];
    existing.push(candidate);
    byRecord.set(key, existing);
  }
  const entries = [...byRecord.values()].map((record) => {
    const values = targetFieldKeys.flatMap((key) => {
      const candidate = record.find((item) => item.targetFieldKey === key);
      return candidate?.value ? [candidate.value] : [];
    });
    return values.join('，');
  }).filter(Boolean);
  if (!entries.length) return undefined;
  return {
    kind: 'text',
    index: field.index,
    fieldKey: `${field.groupLabel}.汇总`,
    value: entries.join('；'),
    shortLabel: `${field.groupLabel}汇总`,
    confidence: 'medium',
    fillMode: field.fillMode,
    source: 'local',
  };
}

function aggregateKeyOrder(field: FormFieldInfo, block: BlockCategory): string[] {
  const storedKeys = [
    ...(block.templateFields ?? []),
    ...block.items.flatMap((item) => item.fields.map((source) => source.key)),
  ].filter((key, index, all) => key.trim() && all.findIndex((other) => normalize(other) === normalize(key)) === index);
  const semanticText = normalize(fieldSemanticText(field));
  const positions = storedKeys.map((key, fallbackIndex) => {
    const variants = [key, ...aliasesFor(key)]
      .map(normalize)
      .filter(Boolean);
    const position = variants.reduce((best, variant) => {
      const found = semanticText.indexOf(variant);
      return found >= 0 && (best < 0 || found < best) ? found : best;
    }, -1);
    return { key, position, fallbackIndex };
  });
  const explicitlyRequested = positions.filter(({ position }) => position >= 0);
  if (explicitlyRequested.length >= 2) {
    return explicitlyRequested.sort((a, b) => a.position - b.position).map(({ key }) => key);
  }
  return positions.sort((a, b) => a.fallbackIndex - b.fallbackIndex).map(({ key }) => key);
}

function cleanAggregateValue(value: string): string {
  return value
    .replace(/[|｜#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findAggregateBlockMatch(
  field: FormFieldInfo,
  blocks: BlockCategory[],
  textFields: TextField[],
): MatchResult | undefined {
  if (field.rowIndex != null || !field.groupLabel) return undefined;
  const block = findBlockForGroup(field, blocks);
  if (!block) return findProjectedAggregateMatch(field, blocks, textFields);
  if (!block?.items.length) return undefined;

  const order = aggregateKeyOrder(field, block);
  const semanticText = fieldSemanticText(field);
  const mentionedKeyCount = order.filter((key) => aliasesFor(key).some((alias) => (
    normalize(semanticText).includes(normalize(alias))
  ))).length;
  if (field.fillMode !== 'long' && mentionedKeyCount < 2) return undefined;

  const entries = block.items.flatMap((item) => {
    const values = order.flatMap((key) => {
      const candidates = item.fields
        .map((source) => ({ source, score: scoreKey(key, source.key) }))
        .sort((a, b) => b.score - a.score);
      const value = cleanAggregateValue(candidates[0]?.source.value ?? '');
      return value ? [value] : [];
    });
    return values.length ? [values.join('，')] : [];
  });
  if (!entries.length) return undefined;

  return {
    kind: 'text',
    index: field.index,
    fieldKey: `${block.title}.汇总`,
    value: entries.join('；'),
    shortLabel: `${block.title}汇总`,
    confidence: field.fillMode === 'long' ? 'high' : 'medium',
    fillMode: field.fillMode,
    source: 'local',
  };
}

function findFlatMatch(field: FormFieldInfo, textFields: TextField[]): MatchResult | undefined {
  if (field.rowIndex != null && field.groupLabel) return undefined;
  const primaryText = primaryFieldSemanticText(field);
  const primaryCandidates = rankedCandidates(primaryText, textFields);
  const primary = chooseUnambiguousCandidate(primaryCandidates);
  const normalizedPrimary = normalize(primaryText);
  const primaryIsMeaningful = Boolean(normalizedPrimary) && !/^(字段|字段值|input|text|value|field\d*)$/i.test(normalizedPrimary);
  const best = primary ?? (
    primaryIsMeaningful
      ? undefined
      : chooseUnambiguousCandidate(rankedCandidates(fieldSemanticText(field), textFields))
  );
  if (!best) return undefined;
  return makeMatch(field, best.source.key, best.source.key, best.source.value, best.score);
}

export function matchFieldsLocally(
  fields: FormFieldInfo[],
  textFields: TextField[],
  blocks: BlockCategory[],
): MatchResult[] {
  const plan = planRepeatableRecords(fields, blocks, textFields);
  return fields.flatMap((field) => {
    const isReadOnlyAudit = isMeaningfullyFilled(field) && /只读|锁定/.test(field.protectionReason ?? '');
    if (field.kind === 'file' || (field.protected && !isReadOnlyAudit)) return [];
    const structured = findStructuredMatch(field, blocks, textFields, plan);
    if (structured) return [structured];
    const aggregate = findAggregateBlockMatch(field, blocks, textFields);
    if (aggregate) return [aggregate];
    const flat = findFlatMatch(field, textFields);
    return flat ? [flat] : [];
  });
}

export function mergeLocalAndAiMatches(
  localMatches: MatchResult[],
  aiMatches: MatchResult[],
  fields: FormFieldInfo[],
  aiEnhanced: boolean,
): MatchResult[] {
  const aiByIndex = new Map(aiMatches.map((match) => [match.index, match]));
  const localByIndex = new Map(localMatches.map((match) => [match.index, match]));
  const fieldByIndex = new Map(fields.map((field) => [field.index, field]));
  const reviewedMatches = localMatches.map((localMatch) => {
    const aiMatch = aiByIndex.get(localMatch.index);
    if (!aiMatch) return localMatch;
    const field = fieldByIndex.get(localMatch.index);
    if (field && isMeaningfullyFilled(field) && !/只读|锁定/.test(field.protectionReason ?? '')) {
      return { ...localMatch, source: 'ai_reviewed' as const };
    }
    const identityBoundRepeatField = field?.rowIndex != null
      && Boolean(field.groupLabel)
      && /\[\d+\]\./.test(localMatch.fieldKey);
    if (identityBoundRepeatField) return { ...localMatch, source: 'ai_reviewed' as const };
    if (aiEnhanced && aiMatch.confidence === 'high') return aiMatch;
    if (localMatch.confidence === 'medium' && aiMatch.confidence === 'high') return aiMatch;
    return { ...localMatch, source: 'ai_reviewed' as const };
  });
  const aiOnlyMatches = aiMatches.filter((match) => {
    if (localByIndex.has(match.index)) return false;
    const field = fieldByIndex.get(match.index);
    return !field || !isMeaningfullyFilled(field) || /只读|锁定/.test(field.protectionReason ?? '');
  });
  return [...reviewedMatches, ...aiOnlyMatches];
}

export function getAiEligibleFields(fields: FormFieldInfo[], localMatches: MatchResult[]): FormFieldInfo[] {
  const locallyMatched = new Set(localMatches.map((match) => match.index));
  return fields.filter((field) => (
    field.kind !== 'file' &&
    !field.protected &&
    !isMeaningfullyFilled(field) &&
    !locallyMatched.has(field.index)
  ));
}
