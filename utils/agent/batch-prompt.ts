import { isSensitiveAgentPageText } from './page-context';
import { agentFingerprint } from './planner';
import type { AgentSourceRecord } from './profile-retriever';
import type { AgentBatchBlueprint, AgentBatchPageInput } from './batch-types';

function safeSourceRecord(record: AgentSourceRecord): AgentSourceRecord {
  const fields = Object.fromEntries(Object.entries(record.fields).filter(([key, value]) => (
    !isSensitiveAgentPageText(`${key} ${value}`)
  )));
  return {
    ...record,
    fields,
    searchText: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('；'),
  };
}

export function sanitizeAgentSourceRecords(records: AgentSourceRecord[]): AgentSourceRecord[] {
  return records.map(safeSourceRecord);
}

export function createAgentBatchBlueprint(
  applicationId: string,
  pages: AgentBatchPageInput[],
  capturedAt = Date.now(),
): AgentBatchBlueprint {
  const normalizedPages = pages.map((page) => ({
    snapshot: page.snapshot,
    sourceRecords: sanitizeAgentSourceRecords(page.sourceRecords),
    fileRecordIds: [...new Set(page.fileRecordIds ?? [])],
  }));
  return {
    version: 1,
    applicationId,
    fingerprint: agentFingerprint({ applicationId, pages: normalizedPages }),
    pages: normalizedPages,
    capturedAt,
  };
}

export function buildAgentBatchPlannerPrompt(blueprint: AgentBatchBlueprint): string {
  const pages = blueprint.pages.map((page) => ({
    pageKey: page.snapshot.pageKey,
    snapshotFingerprint: agentFingerprint(page.snapshot),
    profileFingerprint: agentFingerprint(page.sourceRecords),
    snapshot: page.snapshot,
    sourceRecords: page.sourceRecords,
    fileRecordIds: page.fileRecordIds ?? [],
  }));
  return [
    '你是“保填 Agent”的跨页规划器。请先综合理解同一报名任务的所有页面题干、注释、表头、禁用字符、长度限制和候选资料，再做跨页分配。',
    '同一条资料应放到语义最合适的页面，避免在学术成果、项目经历、学科竞赛、荣誉奖励、学习和工作经历之间机械重复或错投。页面明确要求综合表述时可以组合同类证据；结构化表格必须一行对应一条真实记录。',
    '只规划 add_rows、fill_field、fill_row、select、upload。绝不规划最终提交、确认报名、承诺书、导师/志愿、验证码、支付、删除或任意脚本/选择器。',
    '每个 pagePlan 必须遵守单页 AgentPagePlan 合同：version、pageKey、snapshotFingerprint、profileFingerprint、actions、reviewItems 六个字段；动作只能引用该页实际 targetId/groupId 和该页候选 sourceRecordId。',
    '输出严格 JSON，顶层只能包含 version、blueprintFingerprint、pagePlans、reviewItems。pagePlans 必须恰好覆盖所有 pageKey，每页一次且不能缺页；reviewItems 为跨页层面的字符串数组。',
    `version 必须为 1，blueprintFingerprint 必须原样返回 ${blueprint.fingerprint}。`,
    `跨页蓝图：\n${JSON.stringify({
      applicationId: blueprint.applicationId,
      blueprintFingerprint: blueprint.fingerprint,
      pages,
    })}`,
  ].join('\n\n');
}
