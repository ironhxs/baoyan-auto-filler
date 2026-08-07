export type RepeatDialogSemanticKey =
  | 'name'
  | 'type'
  | 'level'
  | 'date'
  | 'startDate'
  | 'endDate'
  | 'organization'
  | 'relation'
  | 'phone'
  | 'status'
  | 'description'
  | 'role'
  | 'ranking'
  | 'other';

export interface RepeatDialogFieldInput {
  index: number;
  label: string;
  value: string;
  required: boolean;
  kind: 'text' | 'file';
  protected: boolean;
}

export interface ClassifiedRepeatDialogField extends RepeatDialogFieldInput {
  semanticKey: RepeatDialogSemanticKey;
  ambiguous: boolean;
}

export interface RepeatDialogSaveControlClassification {
  safe: boolean;
  reason: 'record-save' | 'protected-action' | 'unknown-action';
}

export function normalizeRepeatDialogText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[：:，,。.（）()【】\[\]\s*_\-/\\]+/g, '')
    .replace(/联系方式|联系号码/g, '联系电话')
    .replace(/单位名称|所在单位/g, '单位')
    .replace(/日期|时间|年月/g, '日期');
}

export function semanticKeyForRepeatDialogLabel(value: string | undefined): RepeatDialogSemanticKey {
  const label = normalizeRepeatDialogText(value);
  if (!label) return 'other';
  if (/开始|起始|入学/.test(label) && /日期|时间|年月/.test(value ?? '')) return 'startDate';
  if (/结束|终止|毕业/.test(label) && /日期|时间|年月/.test(value ?? '')) return 'endDate';
  if (/电话|手机|联系电话/.test(label)) return 'phone';
  if (/关系|称谓/.test(label)) return 'relation';
  if (/排名|位次|顺序|排序/.test(label)) return 'ranking';
  if (/等级|级别|等次|获奖级别|奖项级别/.test(label)) return 'level';
  if (/状态|发表情况|是否发表|录用情况/.test(label)) return 'status';
  if (/开始日期|起始日期/.test(label)) return 'startDate';
  if (/结束日期|终止日期/.test(label)) return 'endDate';
  if (/日期|时间|年月/.test(value ?? '') || /日期/.test(label)) return 'date';
  if (/单位|学校|院校|机构|刊物|期刊|主办方|工作地点|在何.*工作/.test(label)) return 'organization';
  if (/职务|职称|担任|身份/.test(label)) return 'role';
  if (/类型|类别|种类|性质|形式/.test(label)) return 'type';
  if (/备注|描述|简介|说明|内容|主要事迹|工作内容/.test(label)) return 'description';
  if (/姓名|名称|题目|标题|论文题名|专利名|项目名|奖项名|成果名/.test(label)) return 'name';
  return 'other';
}

export function classifyRepeatDialogFields(
  fields: RepeatDialogFieldInput[],
): ClassifiedRepeatDialogField[] {
  const classified = fields.map((field) => ({
    ...field,
    semanticKey: semanticKeyForRepeatDialogLabel(field.label),
    ambiguous: false,
  } satisfies ClassifiedRepeatDialogField));
  const counts = new Map<RepeatDialogSemanticKey, number>();
  for (const field of classified) {
    if (field.semanticKey === 'other') continue;
    counts.set(field.semanticKey, (counts.get(field.semanticKey) ?? 0) + 1);
  }
  return classified.map((field) => ({
    ...field,
    ambiguous: field.semanticKey === 'other' || (counts.get(field.semanticKey) ?? 0) > 1,
  }));
}

export interface RepeatDialogStoredField {
  key: string;
  value: string;
}

export interface RepeatDialogAssignment {
  index: number;
  value: string;
  semanticKey: RepeatDialogSemanticKey;
  sourceKey: string;
}

export type RepeatDialogAssignmentFailureCode =
  | 'ambiguous-required-field'
  | 'protected-required-field'
  | 'missing-required-field'
  | 'missing-source-value';

export interface RepeatDialogAssignmentFailure {
  code: RepeatDialogAssignmentFailureCode;
  index: number;
}

export interface RepeatDialogAssignmentPlan {
  assignments: RepeatDialogAssignment[];
  failures: RepeatDialogAssignmentFailure[];
}

function normalizedSourceKey(value: string): string {
  return normalizeRepeatDialogText(value)
    .replace(/论文|专利|项目|奖项|成果|家庭成员/g, '')
    .replace(/情况|信息/g, '');
}

function aggregateDialogValue(fields: RepeatDialogStoredField[]): { value: string; sourceKey: string } {
  const entries = fields
    .map((field) => ({ key: field.key.trim(), value: field.value.trim() }))
    .filter((field) => field.value);
  return {
    value: entries.map((field) => `${field.key}：${field.value}`).join('；'),
    sourceKey: entries.map((field) => field.key).join('，'),
  };
}

export function planRepeatDialogAssignments(
  fields: ClassifiedRepeatDialogField[],
  storedFields: RepeatDialogStoredField[],
): RepeatDialogAssignmentPlan {
  const assignments: RepeatDialogAssignment[] = [];
  const failures: RepeatDialogAssignmentFailure[] = [];
  const claimedSourceIndexes = new Set<number>();
  const eligibleFields = fields.filter((field) => field.kind !== 'file' && !field.protected);
  const singleAggregateCandidate = eligibleFields.length === 1;
  const sourceWithValues = storedFields.filter((field) => field.value.trim());

  for (const field of fields) {
    if (field.protected || field.kind === 'file') {
      if (field.required) failures.push({ code: 'protected-required-field', index: field.index });
      continue;
    }
    if (field.ambiguous && !singleAggregateCandidate) {
      if (field.required) failures.push({ code: 'ambiguous-required-field', index: field.index });
      continue;
    }

    const exactCandidates = storedFields
      .map((source, index) => ({ source, index }))
      .filter(({ source, index }) => !claimedSourceIndexes.has(index) && normalizedSourceKey(source.key) === normalizedSourceKey(field.label));
    const semanticCandidates = storedFields
      .map((source, index) => ({ source, index, semanticKey: semanticKeyForRepeatDialogLabel(source.key) }))
      .filter(({ source, index, semanticKey }) => (
        !claimedSourceIndexes.has(index) &&
        source.value.trim() &&
        semanticKey !== 'other' &&
        semanticKey === field.semanticKey
      ));
    const candidates = exactCandidates.length > 0 ? exactCandidates : semanticCandidates;
    if (candidates.length === 1) {
      const candidate = candidates[0];
      claimedSourceIndexes.add(candidate.index);
      assignments.push({
        index: field.index,
        value: candidate.source.value,
        semanticKey: field.semanticKey,
        sourceKey: candidate.source.key,
      });
      continue;
    }
    if (candidates.length > 1 && field.required) {
      failures.push({ code: 'ambiguous-required-field', index: field.index });
    }
  }

  const unassignedSource = sourceWithValues.filter((_source, index) => {
    const originalIndex = storedFields.indexOf(_source);
    return !claimedSourceIndexes.has(originalIndex) && index < sourceWithValues.length;
  });
  if (eligibleFields.length === 1 && assignments.length === 0 && unassignedSource.length > 0) {
    const field = eligibleFields[0];
    const aggregate = aggregateDialogValue(unassignedSource);
    assignments.push({
      index: field.index,
      value: aggregate.value,
      semanticKey: field.semanticKey,
      sourceKey: aggregate.sourceKey,
    });
    return { assignments, failures };
  }

  const assignedIndexes = new Set(assignments.map((assignment) => assignment.index));
  for (const field of fields) {
    if (field.required && !assignedIndexes.has(field.index) && !failures.some((failure) => failure.index === field.index)) {
      failures.push({ code: 'missing-required-field', index: field.index });
    }
  }
  if (sourceWithValues.length > 0 && assignments.length === 0 && eligibleFields.length > 0) {
    for (const field of eligibleFields.filter((candidate) => candidate.required)) {
      if (!failures.some((failure) => failure.index === field.index)) {
        failures.push({ code: 'missing-source-value', index: field.index });
      }
    }
  }
  return { assignments, failures };
}

const PROTECTED_ACTION_PATTERN = /(?:提交报名|确认报名|最终提交|提交申请|确认申请|下一步|上一步|志愿|导师|调剂|承诺|协议|验证码|短信码|图形码|支付|缴费|付款|删除|取消报名)/;

export function isProtectedRepeatDialogControl(value: string | undefined): boolean {
  return PROTECTED_ACTION_PATTERN.test(normalizeRepeatDialogText(value));
}

export function classifyRepeatDialogSaveControl(
  value: string | undefined,
): RepeatDialogSaveControlClassification {
  const label = normalizeRepeatDialogText(value);
  if (isProtectedRepeatDialogControl(label)) return { safe: false, reason: 'protected-action' };
  if (/^(?:保存|确定|确认|添加|新增|保存并关闭|保存并继续)$/.test(label)) {
    return { safe: true, reason: 'record-save' };
  }
  return { safe: false, reason: 'unknown-action' };
}
