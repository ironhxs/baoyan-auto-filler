export type RepeatTableMatch = 'none' | 'strong';
export type RepeatPreparationAction = 'skip' | 'failure' | 'prepare';

export function classifyRepeatableHeaderSchema(headers: string[]): string {
  const headerText = headers.join('|').replace(/\s+/g, '');
  if (/姓名/.test(headerText) && /关系/.test(headerText) && /(联系电话|工作单位|职务)/.test(headerText)) {
    return '家庭成员';
  }
  if (/(外语|考试|等级)/.test(headerText) && /成绩/.test(headerText)) return '外语水平';
  if (
    /(开始|起始)/.test(headerText)
    && /(结束|终止)/.test(headerText)
    && /(学校|工作单位|单位)/.test(headerText)
    && /(职务|岗位|专业)/.test(headerText)
  ) {
    return '学习和工作经历';
  }
  if (/(获奖|奖励|奖项|竞赛)/.test(headerText) && /(名称|等级|级别|时间|日期)/.test(headerText)) {
    return '获奖情况';
  }
  if (/论文/.test(headerText) && /(名称|标题|类型|时间|排序|发表)/.test(headerText)) {
    return '论文情况';
  }
  if (/专利/.test(headerText) && /(名称|标题|类型|时间|授权|受理)/.test(headerText)) {
    return '已取得专利';
  }
  if (/(项目|实践)/.test(headerText) && /(描述|时间|期间|角色|单位|名称)/.test(headerText)) {
    return '项目经历';
  }
  return '';
}

export function classifyRepeatPreparation(input: {
  tableMatch: RepeatTableMatch;
  hasAddControl: boolean;
}): RepeatPreparationAction {
  if (input.tableMatch === 'none') return 'skip';
  return input.hasAddControl ? 'prepare' : 'failure';
}

export interface ScopedTriggerCandidate {
  id: string;
  ownerId: string;
  distance: number;
  label: string;
}

export function selectScopedTrigger(
  candidates: ScopedTriggerCandidate[],
  ownerId: string,
): string | undefined {
  const eligible = candidates
    .filter((candidate) => candidate.ownerId === ownerId && /^(选择|请选择|选取)$/i.test(candidate.label.trim()))
    .sort((left, right) => left.distance - right.distance);
  if (eligible.length === 0) return undefined;
  if (eligible.length > 1 && eligible[0].distance === eligible[1].distance) return undefined;
  return eligible[0].id;
}

export interface DialogRootCandidate {
  id: string;
  wasVisibleBefore: boolean;
  associated: boolean;
}

export function selectNewDialogRoot(candidates: DialogRootCandidate[]): string | undefined {
  const eligible = candidates.filter((candidate) => !candidate.wasVisibleBefore && candidate.associated);
  return eligible.length === 1 ? eligible[0].id : undefined;
}

export interface ScopedConfirmCandidate {
  id: string;
  dialogId?: string;
  label: string;
}

export function selectScopedConfirm(
  candidates: ScopedConfirmCandidate[],
  dialogId: string,
): string | undefined {
  const eligible = candidates.filter((candidate) => (
    candidate.dialogId === dialogId && /^(确定|确认|保存)$/i.test(candidate.label.trim())
  ));
  return eligible.length === 1 ? eligible[0].id : undefined;
}
