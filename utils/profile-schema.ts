import type { BlockCategory, BlockItem, TextField } from './db';

export type ProfileSectionId =
  | 'basic'
  | 'family'
  | 'education'
  | 'language'
  | 'research_training'
  | 'internship_practice'
  | 'social_work'
  | 'published_papers'
  | 'granted_patents'
  | 'subject_competitions'
  | 'honors_awards';

export interface ProfileSectionDefinition {
  id: ProfileSectionId;
  title: string;
  icon: string;
  kind: 'flat' | 'repeat';
  fieldKeys: string[];
  optionalFieldKeys?: string[];
}

export interface ProfileSourceValue {
  key: string;
  value: string;
  sectionId: ProfileSectionId | 'custom';
  sectionTitle: string;
  itemIndex?: number;
  fieldKey: string;
}

export const PROFILE_SECTIONS: ProfileSectionDefinition[] = [
  {
    id: 'basic',
    title: '基本信息',
    icon: '📋',
    kind: 'flat',
    fieldKeys: [
      '姓名', '手机号', '邮箱', '住址', '性别', '民族', '政治面貌', '出生地', '籍贯地',
      '户口所在地详细地址', '档案所在单位', '档案所在单位地址', '档案所在单位邮政编码',
      '通讯地址', '通信地址邮政编码', '婚否', '现役军人码', '身份证号码', '出生日期', '紧急电话',
    ],
  },
  {
    id: 'family',
    title: '家庭成员',
    icon: '👨‍👩‍👧',
    kind: 'repeat',
    fieldKeys: ['姓名', '关系', '工作单位及职务', '联系电话'],
  },
  {
    id: 'education',
    title: '学习信息',
    icon: '🎓',
    kind: 'flat',
    fieldKeys: [
      '院系', '学校', '专业', '入学年月', '预计毕业年月', '综合排名', '成绩排名', '排名基数', 'GPA',
      '预计能否获得推免资格', '学号', '辅导员姓名', '辅导员电话',
      '是否来自拔尖人才培养基地', '拔尖人才培养基地名称',
    ],
  },
  {
    id: 'language',
    title: '外语水平',
    icon: '🌐',
    kind: 'repeat',
    fieldKeys: ['考试名称', '成绩', '考试日期', '备注', '证书编号'],
  },
  {
    id: 'research_training',
    title: '科研训练',
    icon: '🔬',
    kind: 'repeat',
    fieldKeys: ['起止时间', '项目名称', '项目级别', '排名'],
    optionalFieldKeys: ['项目描述', '本人角色'],
  },
  {
    id: 'internship_practice',
    title: '实习实践',
    icon: '🧭',
    kind: 'repeat',
    fieldKeys: ['起止时间', '实习实践单位', '主要工作内容'],
    optionalFieldKeys: ['实践类型', '本人角色'],
  },
  {
    id: 'social_work',
    title: '社会工作',
    icon: '🤝',
    kind: 'repeat',
    fieldKeys: ['起止时间', '社会工作名称', '主要工作内容'],
    optionalFieldKeys: ['本人角色', '组织/单位'],
  },
  {
    id: 'published_papers',
    title: '已发表论文',
    icon: '📝',
    kind: 'repeat',
    fieldKeys: ['作者', '论文标题', '刊物/会议名称', '发表时间'],
    optionalFieldKeys: ['论文类型', '发表状态', '分区', '本人排名'],
  },
  {
    id: 'granted_patents',
    title: '已取得专利',
    icon: '💡',
    kind: 'repeat',
    fieldKeys: ['专利权人', '专利名称', '授权或受理时间'],
    optionalFieldKeys: ['专利类型', '专利状态', '专利号', '本人排名'],
  },
  {
    id: 'subject_competitions',
    title: '学科竞赛',
    icon: '🏅',
    kind: 'repeat',
    fieldKeys: ['获奖人', '获奖项目名称', '竞赛名称', '获奖等级', '获奖时间'],
    optionalFieldKeys: ['主办单位', '描述', '本人排名'],
  },
  {
    id: 'honors_awards',
    title: '本科期间校级以上（含）荣誉奖励',
    icon: '🏆',
    kind: 'repeat',
    fieldKeys: ['获奖名称', '获奖等级', '获奖时间'],
    optionalFieldKeys: ['主办单位', '描述', '本人排名'],
  },
];

export const DEFAULT_REPEAT_SECTIONS = PROFILE_SECTIONS.filter((section) => section.kind === 'repeat');

const FLAT_LANGUAGE_KEYS = new Set(['外语考试成绩', '英语四级成绩', '英语六级成绩', '雅思成绩', '托福成绩']);

export function getSectionDefinition(id: string | undefined): ProfileSectionDefinition | undefined {
  return PROFILE_SECTIONS.find((section) => section.id === id);
}

export function getSectionFieldKeys(id: string | undefined): string[] {
  return [...(getSectionDefinition(id)?.fieldKeys ?? [])];
}

export function getOptionalSectionFieldKeys(id: string | undefined): string[] {
  return [...(getSectionDefinition(id)?.optionalFieldKeys ?? [])];
}

export function getFlatSectionId(key: string): Extract<ProfileSectionId, 'basic' | 'education' | 'language'> | 'custom' {
  if (FLAT_LANGUAGE_KEYS.has(key)) return 'language';
  if (PROFILE_SECTIONS.find((section) => section.id === 'education')?.fieldKeys.includes(key)) return 'education';
  if (PROFILE_SECTIONS.find((section) => section.id === 'basic')?.fieldKeys.includes(key)) return 'basic';
  return 'custom';
}

export function getBlockSection(block: BlockCategory): ProfileSectionDefinition | undefined {
  return getSectionDefinition(block.sectionId) ?? PROFILE_SECTIONS.find((section) => section.title === block.title);
}

export function inferLanguageItems(textFields: Array<Pick<TextField, 'key' | 'value'>>): BlockItem[] {
  const values = new Map(textFields.map((field) => [field.key.trim(), field.value.trim()]));
  const inferred = new Map<string, { score: string; date: string; note: string; certificate: string }>();
  const ensure = (exam: string) => {
    if (!inferred.has(exam)) inferred.set(exam, { score: '', date: '', note: '', certificate: '' });
    return inferred.get(exam)!;
  };

  const cet4 = values.get('英语四级成绩') || values.get('四级成绩') || '';
  const cet6 = values.get('英语六级成绩') || values.get('六级成绩') || '';
  if (cet4) ensure('CET-4').score = cet4;
  if (cet6) ensure('CET-6').score = cet6;

  const summary = values.get('外语考试成绩') || '';
  for (const match of summary.matchAll(/(?:CET[-\s]?|英语|大学英语)([四六46])(?:级)?\s*[:：]?\s*(\d+(?:\.\d+)?)/gi)) {
    const exam = /四|4/.test(match[1]) ? 'CET-4' : 'CET-6';
    if (!ensure(exam).score) ensure(exam).score = match[2];
  }

  for (const [exam, prefix] of [['CET-4', '英语四级'], ['CET-6', '英语六级']] as const) {
    const item = inferred.get(exam);
    if (!item) continue;
    item.date = values.get(`${prefix}考试日期`) || values.get(`${prefix}取得时间`) || '';
    item.note = values.get(`${prefix}备注`) || '';
    item.certificate = values.get(`${prefix}证书编号`) || '';
  }

  return Array.from(inferred.entries()).map(([exam, item]) => ({
    fields: [
      { key: '考试名称', value: exam },
      { key: '成绩', value: item.score },
      { key: '考试日期', value: item.date },
      { key: '备注', value: item.note },
      { key: '证书编号', value: item.certificate },
    ],
  }));
}

export function flattenProfileValues(
  textFields: Array<Pick<TextField, 'key' | 'value'>>,
  blocks: BlockCategory[],
): ProfileSourceValue[] {
  const flatValues = textFields.flatMap((field) => {
    const value = field.value.trim();
    if (!value) return [];
    const sectionId = getFlatSectionId(field.key);
    const section = getSectionDefinition(sectionId);
    return [{
      key: field.key,
      value,
      sectionId,
      sectionTitle: section?.title ?? '其他资料',
      fieldKey: field.key,
    } satisfies ProfileSourceValue];
  });

  const blockValues = blocks.flatMap((block) => {
    const section = getBlockSection(block);
    return block.items.flatMap((item, itemIndex) => item.fields.flatMap((field) => {
      const value = field.value.trim();
      if (!value) return [];
      return [{
        key: `${block.title}[${itemIndex + 1}].${field.key}`,
        value,
        sectionId: section?.id ?? 'custom',
        sectionTitle: block.title,
        itemIndex,
        fieldKey: field.key,
      } satisfies ProfileSourceValue];
    }));
  });

  return [...flatValues, ...blockValues];
}
