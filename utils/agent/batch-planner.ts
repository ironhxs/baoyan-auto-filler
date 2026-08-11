import type { ApiConfig } from '../storage';
import { buildAgentBatchPlannerPrompt } from './batch-prompt';
import { AgentBatchPlanValidationError, parseAgentBatchPlan } from './batch-response';
import type { AgentBatchBlueprint, AgentBatchPlan } from './batch-types';

export type AgentBatchRequestText = (
  apiConfig: ApiConfig,
  prompt: string,
  options: { stream: boolean },
) => Promise<string>;

export async function requestAgentBatchPlan(
  blueprint: AgentBatchBlueprint,
  apiConfig: ApiConfig,
  options: { requestText: AgentBatchRequestText },
): Promise<AgentBatchPlan> {
  const basePrompt = buildAgentBatchPlannerPrompt(blueprint);
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await options.requestText(apiConfig, prompt, { stream: true });
    try {
      return parseAgentBatchPlan(text, blueprint);
    } catch (error) {
      if (!(error instanceof AgentBatchPlanValidationError) || attempt > 0) throw error;
      prompt = [
        basePrompt,
        '上一版跨页计划未通过本地校验。只返回修正后的严格 JSON，不要解释，不要遗漏任何页面，也不要放宽事实证据或安全边界。',
        `校验错误：${error.message.slice(0, 500)}`,
      ].join('\n\n');
    }
  }
  throw new Error('Agent batch plan repair attempt did not return a valid plan');
}
