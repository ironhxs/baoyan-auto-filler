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
  if (includesAny(text, ['论文情况', '发表论文', '论文名称', '刊物/会议', '论文标题'])) return 'publication';
  if (includesAny(text, ['专利情况', '取得专利', '专利名称', '专利权人', '授权或受理'])) return 'patent';
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

export function retrieveAgentSourceRecords(
  snapshot: AgentPageSnapshot,
  blocks: BlockCategory[],
  fields: TextField[],
): AgentSourceRecord[] {
  const intent = inferAgentPageIntent(snapshot);
  const records = blocks
    .filter((category) => categoryMatchesIntent(category, intent))
    .flatMap((category) => category.items
      .map((_, itemIndex) => serializeBlockRecord(category, itemIndex))
      .filter((record): record is AgentSourceRecord => record != null));

  if (intent === 'basic' || intent === 'unknown') records.unshift(...serializeFlatFields(fields));
  return records;
}

