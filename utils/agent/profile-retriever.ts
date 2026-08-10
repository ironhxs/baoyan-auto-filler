import type { BlockCategory, TextField } from '../db';
import type { AgentPageSnapshot } from './types';

export type AgentPageIntent =
  | 'basic'
  | 'family'
  | 'education_career'
  | 'language'
  | 'project'
  | 'publication'
  | 'patent'
  | 'academic_achievement'
  | 'competition'
  | 'honor'
  | 'award'
  | 'material'
  | 'unknown';

export interface AgentSourceRecord {
  recordId: string;
  categoryId: string;
  categoryLabel: string;
  itemIndex: number;
  fields: Record<string, string>;
  searchText: string;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function snapshotSemanticText(snapshot: AgentPageSnapshot): string {
  return [
    snapshot.title,
    snapshot.stepText,
    ...snapshot.instructions,
    ...snapshot.groups.flatMap((group) => [
      group.label,
      ...group.columns.map((column) => column.label),
      ...group.fields.map((field) => field.label),
    ]),
  ].map(normalizeText).filter(Boolean).join(' ');
}

function includesAll(text: string, values: string[]): boolean {
  return values.every((value) => text.includes(value));
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function inferAgentPageIntent(snapshot: AgentPageSnapshot): AgentPageIntent {
  const text = snapshotSemanticText(snapshot);

  // This must precede the project rules: "学校或工作单位" contains the word "工作"
  // but represents an education/career chronology, not a project record.
  const careerColumns = includesAll(text, ['起始时间', '结束时间'])
    && includesAny(text, ['学校或工作单位', '学校/工作单位', '学习或工作单位', '担任职务']);
  if (careerColumns || includesAny(text, ['教育经历', '学习与工作履历', '学习和工作经历'])) {
    return 'education_career';
  }

  if (includesAny(text, ['家庭成员', '家庭关系', '父亲', '母亲'])) return 'family';
  if (includesAny(text, ['外语水平', '外语成绩', '英语四级', '英语六级', 'CET-4', 'CET-6', '雅思', '托福'])) {
    return 'language';
  }
  // Composite academic-achievement questions often mention papers and awards in their
  // instructions. Recognize the whole question before the narrower paper/award rules.
  if (includesAny(text, ['学术成果', '科研成果', '学术活动', '科研学术成果'])) {
    return 'academic_achievement';
  }
  if (includesAny(text, ['论文情况', '发表论文', '论文名称', '刊物/会议', '论文标题'])) return 'publication';
  if (includesAny(text, ['专利情况', '取得专利', '专利名称', '专利权人', '授权或受理'])) return 'patent';
  if (includesAny(text, ['学科竞赛', '竞赛名称', '赛事名称', '比赛名称'])) return 'competition';
  if (includesAny(text, [
    '何时何地何原因受过何种奖励',
    '何时何地因何受过何种奖励',
    '奖励情况（本科期间）',
    '本科期间奖励情况',
    '荣誉奖励',
    '荣誉称号',
  ])) return 'honor';
  if (includesAny(text, ['奖励情况', '获奖情况', '荣誉奖励', '奖项名称', '获奖等级', '学科竞赛', '竞赛名称'])) {
    return 'award';
  }
  if (includesAny(text, ['材料上传', '证明材料', '附件上传', '上传文件', '证书上传'])) return 'material';

  const projectColumns = includesAny(text, ['项目名称', '项目描述'])
    && includesAny(text, ['项目时间', '时间段', '本人角色', '项目级别']);
  if (projectColumns || includesAny(text, ['项目经历', '科研训练', '实习实践', '社会工作', '科研、实践及项目经历'])) {
    return 'project';
  }

  if (includesAny(text, [
    '基本信息', '个人信息', '联系方式', '身份证', '出生日期', '学校信息', '学习信息',
  ])) return 'basic';
  return 'unknown';
}

const INTENT_CATEGORY_IDS: Record<Exclude<AgentPageIntent, 'basic' | 'material' | 'unknown'>, string[]> = {
  family: ['family_members'],
  education_career: ['education_career'],
  language: ['language_skills'],
  project: ['research_training', 'internship_practice', 'social_work', 'project_experience'],
  publication: ['published_papers'],
  patent: ['granted_patents'],
  academic_achievement: ['subject_competitions', 'research_training', 'published_papers', 'granted_patents', 'project_experience'],
  competition: ['subject_competitions'],
  honor: ['honors_awards'],
  award: ['subject_competitions', 'honors_awards'],
};

function categoryId(category: BlockCategory): string {
  if (normalizeText(category.sectionId)) return normalizeText(category.sectionId);
  if (category.id != null) return `block_${category.id}`;
  return `block_${normalizeText(category.title).replace(/\s+/g, '_') || 'unknown'}`;
}

function categoryMatchesIntent(category: BlockCategory, intent: AgentPageIntent): boolean {
  const id = categoryId(category);
  if (intent === 'unknown') return true;
  if (intent === 'basic' || intent === 'material') return false;
  if (INTENT_CATEGORY_IDS[intent].includes(id)) return true;

  const title = normalizeText(category.title);
  switch (intent) {
    case 'family': return /家庭成员/.test(title);
    case 'education_career': return /学习.*工作.*履历|教育经历|学习和工作经历/.test(title);
    case 'language': return /外语|英语|语言/.test(title);
    case 'project': return /科研训练|项目经历|实习实践|社会工作/.test(title);
    case 'publication': return /论文/.test(title);
    case 'patent': return /专利/.test(title);
    case 'academic_achievement': return /学科竞赛|科研训练|科研项目|项目经历|论文|专利/.test(title);
    case 'competition': return /学科竞赛|竞赛|赛事|比赛/.test(title);
    case 'honor': return /荣誉奖励|荣誉称号|奖学金|三好学生|优秀共青团员|优秀心理委员/.test(title);
    case 'award': return /学科竞赛|奖励|获奖|荣誉/.test(title);
    default: return false;
  }
}

function serializeBlockRecord(
  category: BlockCategory,
  itemIndex: number,
): AgentSourceRecord | null {
  const fields: Record<string, string> = {};
  for (const field of category.items[itemIndex]?.fields ?? []) {
    const key = normalizeText(field.key);
    const value = normalizeText(field.value);
    if (key && value) fields[key] = value;
  }
  if (Object.keys(fields).length === 0) return null;
  const id = categoryId(category);
  return {
    recordId: `${id}:${itemIndex}`,
    categoryId: id,
    categoryLabel: normalizeText(category.title) || id,
    itemIndex,
    fields,
    searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
  };
}

function serializeFlatFields(fields: TextField[]): AgentSourceRecord[] {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const key = normalizeText(field.key);
    const value = normalizeText(field.value);
    if (key && value) values[key] = value;
  }
  if (Object.keys(values).length === 0) return [];
  return [{
    recordId: 'basic_fields:0',
    categoryId: 'basic_fields',
    categoryLabel: '基本资料',
    itemIndex: 0,
    fields: values,
    searchText: Object.entries(values).map(([key, value]) => `${key}: ${value}`).join('；'),
  }];
}

function firstProfileValue(fields: TextField[], keys: RegExp): string {
  return normalizeText(fields.find((field) => keys.test(normalizeText(field.key)))?.value);
}

const PROVINCE_NAMES = [
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海',
  '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门', '台湾',
] as const;

function geographicPlaceEvidence(text: string): string {
  const value = normalizeText(text);
  const directional = value.match(/(?:华东|华北|华南|东北|西北|西南|中南)(?=区域赛|地区赛|赛区|区域|地区)/)?.[0];
  if (directional) return `${directional}地区`;

  for (const name of PROVINCE_NAMES) {
    if (value.includes(`${name}省`)) return `${name}省`;
    if (value.includes(`${name}市`)) return `${name}市`;
    if (new RegExp(`${name}(?:赛区|区域赛|地区赛)`).test(value)) {
      return ['北京', '天津', '上海', '重庆', '香港', '澳门'].includes(name) ? `${name}市` : `${name}省`;
    }
  }

  const cityAfterRelation = value.match(/(?:获评?|授予|颁发|位于|在|由)([\u4e00-\u9fa5]{2,6}?市)(?!级)/)?.[1];
  if (cityAfterRelation) return cityAfterRelation;
  const delimitedCity = value.match(/(?:^|[，,。；;、\s])([\u4e00-\u9fa5]{2,6}?市)(?!级)/)?.[1];
  if (delimitedCity) return delimitedCity;
  return '';
}

function awardAnchorPhrases(values: Record<string, string>): string[] {
  const name = normalizeText(values.获奖名称 || values.奖项名称 || values.获奖项目名称 || values.项目名称);
  if (!name) return [];
  const quoted = [...name.matchAll(/[“\"《]([^”\"》]{4,})[”\"》]/g)].map((match) => normalizeText(match[1]));
  const awardTypes = [...name.matchAll(/(?:优秀)?(?:资政报告|调研报告|典型案例|实践标兵|优秀团队|奖学金|三好学生|共青团员|心理委员)/g)]
    .map((match) => normalizeText(match[0]));
  const compact = name
    .replace(/20\d{2}(?:[—–-]20\d{2})?学?年/g, '')
    .replace(/暑期|社会实践|大学生|优秀|获奖|奖项|校级|省级|市级|国家级/g, '')
    .replace(/[\s“”\"《》：:，,。；;（）()\-—–]/g, '');
  return [...new Set([
    ...quoted,
    ...awardTypes,
    ...(compact.length >= 6 ? [compact] : []),
  ])];
}

function relatedAwardPlaceEvidence(values: Record<string, string>, blocks: BlockCategory[]): string {
  const anchors = awardAnchorPhrases(values);
  if (anchors.length === 0) return '';
  for (const category of blocks) {
    if (categoryMatchesIntent(category, 'award')) continue;
    for (const item of category.items) {
      const text = item.fields.map((field) => normalizeText(field.value)).filter(Boolean).join('；');
      if (!anchors.some((anchor) => text.replace(/\s+/g, '').includes(anchor.replace(/\s+/g, '')))) continue;
      const place = geographicPlaceEvidence(text);
      if (place) return place;
    }
  }
  return '';
}

function awardPlaceEvidence(values: Record<string, string>, school: string, blocks: BlockCategory[]): string {
  const direct = normalizeText(
    values.获奖地点 || values.地点 || values.主办单位 || values.颁发单位 || values.组织单位,
  );
  if (direct) return direct;

  const level = normalizeText(values.获奖等级 || values.奖项等级 || values.奖项级别);
  const competition = normalizeText(values.竞赛名称 || values.赛事名称);
  const awardName = normalizeText(values.获奖名称 || values.奖项名称);
  const semanticText = `${level}；${competition}；${awardName}`;
  const region = geographicPlaceEvidence(semanticText);
  if (region) return region;

  const namedSchool = awardName.match(/[\u4e00-\u9fa5]{2,24}(?:大学|学院|中学)/)?.[0];
  if (namedSchool) return namedSchool;
  if (school && /校级|院级/.test(level)) return school;
  return relatedAwardPlaceEvidence(values, blocks);
}

function enrichAwardRecord(record: AgentSourceRecord, school: string, blocks: BlockCategory[]): AgentSourceRecord {
  if (!['subject_competitions', 'honors_awards'].includes(record.categoryId)) return record;
  const fields = { ...record.fields };
  const place = awardPlaceEvidence(fields, school, blocks);
  if (place) fields.地点语义证据 = place;
  return {
    ...record,
    fields,
    searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
  };
}

function academicAggregateRecord(records: AgentSourceRecord[]): AgentSourceRecord | null {
  const fields: Record<string, string> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record.fields)) {
      fields[`${record.categoryLabel}[${record.itemIndex + 1}].${key}`] = value;
    }
  }
  if (Object.keys(fields).length === 0) return null;
  return {
    recordId: 'academic_achievement:aggregate',
    categoryId: 'academic_achievement',
    categoryLabel: '学术成果综合资料',
    itemIndex: 0,
    fields,
    searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
  };
}

export function retrieveAgentSourceRecords(
  snapshot: AgentPageSnapshot,
  blocks: BlockCategory[],
  fields: TextField[],
): AgentSourceRecord[] {
  const intent = inferAgentPageIntent(snapshot);
  let records = blocks
    .filter((category) => categoryMatchesIntent(category, intent))
    .flatMap((category) => category.items
      .map((_, itemIndex) => serializeBlockRecord(category, itemIndex))
      .filter((record): record is AgentSourceRecord => record != null));

  if (intent === 'award' || intent === 'honor') {
    const school = firstProfileValue(fields, /^(?:学校|所在学校|本科院校|毕业院校)$/);
    records = records.map((record) => enrichAwardRecord(record, school, blocks));
  }
  if (intent === 'academic_achievement' && !snapshot.groups.some((group) => group.kind === 'repeatable')) {
    const aggregate = academicAggregateRecord(records);
    if (aggregate) records = [aggregate];
  }
  if (intent === 'basic' || intent === 'unknown') records.unshift(...serializeFlatFields(fields));
  return records;
}
