export interface RepeatCommitExecutionResult {
  targetId: string;
  matched: boolean;
}

export type RepeatRecordCommitDecision =
  | { action: 'commit'; groupLabel: string; committedTargetIds: string[] }
  | { action: 'skip'; reason: 'no-record-fields' | 'record-fields-not-verified' | 'no-dialog-group' }
  | { action: 'fail'; reason: 'multiple-dialog-groups' };

export function decideRepeatRecordCommit(input: {
  targetIds: string[];
  executionResults: RepeatCommitExecutionResult[];
  visibleDialogGroups: string[];
}): RepeatRecordCommitDecision {
  const targetIds = [...new Set(input.targetIds.filter(Boolean))];
  if (targetIds.length === 0) return { action: 'skip', reason: 'no-record-fields' };

  const verifiedTargets = new Set(
    input.executionResults
      .filter((result) => result.matched)
      .map((result) => result.targetId),
  );
  if (
    input.executionResults.length !== targetIds.length
    || !targetIds.every((targetId) => verifiedTargets.has(targetId))
  ) {
    return { action: 'skip', reason: 'record-fields-not-verified' };
  }

  const visibleDialogGroups = [...new Set(input.visibleDialogGroups.filter(Boolean))];
  if (visibleDialogGroups.length === 0) return { action: 'skip', reason: 'no-dialog-group' };
  if (visibleDialogGroups.length > 1) return { action: 'fail', reason: 'multiple-dialog-groups' };
  return {
    action: 'commit',
    groupLabel: visibleDialogGroups[0],
    committedTargetIds: targetIds,
  };
}
