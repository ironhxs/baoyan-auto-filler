export type RepeatTableMatch = 'none' | 'strong';
export type RepeatPreparationAction = 'skip' | 'failure' | 'prepare';

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
