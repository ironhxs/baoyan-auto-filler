import type { BlockCategory, TextField } from './db';
import type { ProfileSectionId } from './profile-schema';

export interface TargetFieldSchema {
  groupLabel: string;
  fields: Array<{
    key: string;
    label: string;
    required?: boolean;
    multiline?: boolean;
  }>;
}

export interface ProfileProjectionCandidate {
  sourceSectionId: ProfileSectionId | 'custom';
  sourceItemIndex: number;
  sourceFieldKeys: string[];
  targetFieldKey: string;
  value: string;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

type SourceSectionId = ProfileProjectionCandidate['sourceSectionId'];

const REPEAT_SECTION_IDS: SourceSectionId[] = [
  'education_career',
  'research_training',
  'internship_practice',
  'social_work',
  'published_papers',
  'granted_patents',
  'subject_competitions',
  'honors_awards',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　：:，,。；;（）()【】\[\]\/|｜_*#]/g, '');
}

function getSourceSection(block: BlockCategory): SourceSectionId {
  return (block.sectionId && REPEAT_SECTION_IDS.includes(block.sectionId as SourceSectionId)
    ? block.sectionId
    : 'custom') as SourceSectionId;
}

function sourceSectionsForTarget(target: TargetFieldSchema): SourceSectionId[] {
  const label = normalize(target.groupLabel);
  const targetFields = normalize(target.fields.map((field) => `${field.key}${field.label}`).join(''));
  const chronologyTarget = /学习和工作经历|从高中|教育经历|学习经历/.test(label)
    || (
      /(起始时间|开始时间)/.test(targetFields)
      && /结束时间/.test(targetFields)
      && /学校或工作单位/.test(targetFields)
      && /担任职务/.test(targetFields)
    );
  if (chronologyTarget) return ['education_career'];
  if (/论文|学术成果|论文情况/.test(label)) return ['published_papers'];
  if (
    /项目经历|项目经验|科研实践/.test(label)
    || (/经历/.test(label) && /(项目名称|项目描述|项目时间|本人角色)/.test(targetFields))
  ) {
    return ['research_training', 'internship_practice', 'social_work'];
  }
  if (/获奖|奖励|荣誉|竞赛|奖项/.test(label)) {
    return ['subject_competitions', 'honors_awards'];
  }
  return REPEAT_SECTION_IDS.filter((id) => normalize(id) === label);
}

function valueOf(item: { fields: Array<{ key: string; value: string }> }, keys: string[]): { key: string; value: string } | undefined {
  const wanted = keys.map(normalize);
  return item.fields.find((field) => wanted.includes(normalize(field.key)) && field.value.trim());
}

function splitAwardLevelAndGrade(value: string): { level: string; grade: string } {
  const gradeMatch = value.match(/(特等奖|一等奖|二等奖|三等奖|优秀奖|金奖|银奖|铜奖|冠军|亚军|季军|一等奖学金|二等奖学金|三等奖学金)/);
  if (!gradeMatch || gradeMatch.index == null) return { level: value.trim(), grade: '' };
  const level = value.slice(0, gradeMatch.index).replace(/[\s，,；;：:]+$/g, '').trim();
  return { level: level || value.trim(), grade: gradeMatch[0] };
}

function resolveSourceField(target: string, sourceSectionId: SourceSectionId): { keys: string[]; transform?: (value: string) => string; derived?: boolean; reason: string } | undefined {
  const label = normalize(target);

  if (sourceSectionId === 'education_career') {
    if (/起始|开始/.test(label)) return { keys: ['起始时间'], reason: '履历起始时间按语义映射' };
    if (/结束|终止/.test(label)) return { keys: ['结束时间'], reason: '履历结束时间按语义映射' };
    if (/学校|工作单位|单位|机构/.test(label)) return { keys: ['学校或工作单位'], reason: '学校或工作单位按语义映射' };
    if (/职务|岗位|身份/.test(label)) return { keys: ['担任职务'], reason: '担任职务按语义映射' };
  }

  if (sourceSectionId === 'research_training') {
    if (/时间|日期|项目时间/.test(label)) return { keys: ['起止时间'], reason: '项目时间字段按语义映射' };
    if (/项目名称|研究项目|课题名称|项目题目/.test(label)) return { keys: ['项目名称'], reason: '项目名称按语义映射' };
    if (/级别|项目层次/.test(label)) return { keys: ['项目级别'], reason: '项目级别按语义映射' };
    if (/排名|名次|排序/.test(label)) return { keys: ['排名'], reason: '项目排名按语义映射' };
    if (/描述|内容|简介|说明/.test(label)) return { keys: ['项目描述', '主要工作内容'], reason: '项目描述按语义映射' };
    if (/角色|职务|本人身份/.test(label)) return { keys: ['本人角色'], reason: '本人角色按语义映射' };
  }

  if (sourceSectionId === 'internship_practice') {
    if (/时间|日期/.test(label)) return { keys: ['起止时间'], reason: '实习实践时间按语义映射' };
    if (/单位|机构|公司|实习实践/.test(label)) return { keys: ['实习实践单位'], reason: '实习实践单位按语义映射' };
    if (/描述|内容|职责|工作/.test(label)) return { keys: ['主要工作内容'], reason: '实习实践内容按语义映射' };
    if (/类型|类别/.test(label)) return { keys: ['实践类型'], reason: '实践类型按语义映射' };
    if (/角色|职务/.test(label)) return { keys: ['本人角色'], reason: '本人角色按语义映射' };
  }

  if (sourceSectionId === 'social_work') {
    if (/时间|日期/.test(label)) return { keys: ['起止时间'], reason: '社会工作时间按语义映射' };
    if (/名称|职务|岗位|社会工作/.test(label)) return { keys: ['社会工作名称'], reason: '社会工作名称按语义映射' };
    if (/描述|内容|职责|工作/.test(label)) return { keys: ['主要工作内容'], reason: '社会工作内容按语义映射' };
    if (/组织|单位|机构/.test(label)) return { keys: ['组织/单位'], reason: '社会工作组织按语义映射' };
    if (/角色|本人身份/.test(label)) return { keys: ['本人角色'], reason: '本人角色按语义映射' };
  }

  if (sourceSectionId === 'published_papers') {
    if (/作者|完成人|本人作者/.test(label)) return { keys: ['作者'], reason: '论文作者按语义映射' };
    if (/标题|名称|题目/.test(label)) return { keys: ['论文标题'], reason: '论文标题按语义映射' };
    if (/刊物|期刊|会议|发表载体/.test(label)) return { keys: ['刊物/会议名称'], reason: '论文刊物或会议按语义映射' };
    if (/发表|接收|时间|年月/.test(label)) return { keys: ['发表时间'], reason: '论文发表时间按语义映射' };
    if (/类型|类别/.test(label)) return { keys: ['论文类型'], reason: '论文类型按语义映射' };
    if (/状态/.test(label)) return { keys: ['发表状态'], reason: '论文发表状态按语义映射' };
    if (/分区/.test(label)) return { keys: ['分区'], reason: '论文分区按语义映射' };
    if (/排名|名次|排序/.test(label)) return { keys: ['本人排名'], reason: '论文本人排名按语义映射' };
  }

  if (sourceSectionId === 'granted_patents') {
    if (/权人|发明人|作者/.test(label)) return { keys: ['专利权人'], reason: '专利权人按语义映射' };
    if (/名称|标题|题目/.test(label)) return { keys: ['专利名称'], reason: '专利名称按语义映射' };
    if (/授权|受理|时间|年月/.test(label)) return { keys: ['授权或受理时间'], reason: '专利时间按语义映射' };
    if (/类型|类别/.test(label)) return { keys: ['专利类型'], reason: '专利类型按语义映射' };
    if (/状态/.test(label)) return { keys: ['专利状态'], reason: '专利状态按语义映射' };
    if (/专利号|编号/.test(label)) return { keys: ['专利号'], reason: '专利号按语义映射' };
    if (/排名|名次|排序/.test(label)) return { keys: ['本人排名'], reason: '专利本人排名按语义映射' };
  }

  if (sourceSectionId === 'subject_competitions') {
    if (/获奖人|获奖者|作者|完成人/.test(label)) return { keys: ['获奖人'], reason: '竞赛获奖人按语义映射' };
    if (/项目|成果|奖项名称|奖励名称|荣誉名称/.test(label) && !/竞赛|比赛/.test(label)) {
      return { keys: ['获奖项目名称'], reason: '竞赛项目名称按语义映射' };
    }
    if (/竞赛|比赛|赛事/.test(label)) return { keys: ['竞赛名称'], reason: '竞赛名称按语义映射' };
    if (/级别/.test(label)) return { keys: ['获奖等级'], transform: (value) => splitAwardLevelAndGrade(value).level, derived: true, reason: '从合并的获奖等级中拆分奖项级别' };
    if (/等级|等次/.test(label)) return { keys: ['获奖等级'], transform: (value) => splitAwardLevelAndGrade(value).grade || value, derived: true, reason: '从合并的获奖等级中拆分奖项等级' };
    if (/时间|日期|年月/.test(label)) return { keys: ['获奖时间'], reason: '竞赛获奖时间按语义映射' };
    if (/主办|颁发|授予|组织/.test(label)) return { keys: ['主办单位'], reason: '竞赛主办单位按语义映射' };
    if (/描述|说明|简介/.test(label)) return { keys: ['描述'], reason: '竞赛描述按语义映射' };
    if (/排名|名次|排序/.test(label)) return { keys: ['本人排名'], reason: '竞赛本人排名按语义映射' };
  }

  if (sourceSectionId === 'honors_awards') {
    if (/级别|等级/.test(label)) return { keys: ['获奖等级'], reason: '荣誉奖励级别按语义映射' };
    if (/名称|奖项|奖励|荣誉/.test(label)) return { keys: ['获奖名称'], reason: '荣誉奖励名称按语义映射' };
    if (/时间|日期|年月/.test(label)) return { keys: ['获奖时间'], reason: '荣誉奖励时间按语义映射' };
    if (/主办|颁发|授予|组织/.test(label)) return { keys: ['主办单位'], reason: '荣誉奖励授予单位按语义映射' };
    if (/描述|说明|简介/.test(label)) return { keys: ['描述'], reason: '荣誉奖励描述按语义映射' };
    if (/排名|名次|排序/.test(label)) return { keys: ['本人排名'], reason: '荣誉奖励本人排名按语义映射' };
  }

  return undefined;
}

export function projectProfileToTargetSchema(
  target: TargetFieldSchema,
  blocks: BlockCategory[],
  _textFields: TextField[] = [],
): ProfileProjectionCandidate[] {
  const sourceIds = sourceSectionsForTarget(target);
  const candidates: ProfileProjectionCandidate[] = [];

  for (const block of blocks) {
    const sourceSectionId = getSourceSection(block);
    if (!sourceIds.includes(sourceSectionId)) continue;
    block.items.forEach((item, sourceItemIndex) => {
      for (const targetField of target.fields) {
        const mapping = resolveSourceField(targetField.label || targetField.key, sourceSectionId);
        if (!mapping) continue;
        const source = valueOf(item, mapping.keys);
        if (!source) continue;
        const value = mapping.transform ? mapping.transform(source.value) : source.value.trim();
        if (!value) continue;
        candidates.push({
          sourceSectionId,
          sourceItemIndex,
          sourceFieldKeys: [source.key],
          targetFieldKey: targetField.key,
          value,
          confidence: mapping.derived ? 0.86 : 0.98,
          reason: mapping.reason,
          needsReview: Boolean(mapping.derived),
        });
      }
    });
  }

  return candidates;
}
