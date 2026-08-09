export interface AgentRunAccounting {
  totalFilled: number;
  pageFilled: number;
}

export function accountAgentRun(currentTotal: number, runSuccess: number): AgentRunAccounting {
  const pageFilled = Math.max(0, Math.trunc(runSuccess));
  return {
    totalFilled: Math.max(0, Math.trunc(currentTotal)) + pageFilled,
    pageFilled,
  };
}
