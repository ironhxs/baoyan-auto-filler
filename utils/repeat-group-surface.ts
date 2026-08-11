export type RepeatGroupSurfaceNodeKind = 'heading' | 'table' | 'add' | 'other';

export interface RepeatGroupSurfaceNode<T = string> {
  id: T;
  kind: RepeatGroupSurfaceNodeKind;
  visible: boolean;
}

export interface AdjacentRepeatGroupSurfaceInput<T = string> {
  targetGroup: string;
  headingGroup: string;
  following: RepeatGroupSurfaceNode<T>[];
}

export interface AdjacentRepeatGroupSurfaceSelection<T = string> {
  tableId: T | undefined;
  addControlId: T | undefined;
  reason: 'surface' | 'surface-without-add' | 'heading-mismatch' | 'table-not-found';
}

function sameGroup(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/gu, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function selectAdjacentRepeatGroupSurface<T>(
  input: AdjacentRepeatGroupSurfaceInput<T>,
): AdjacentRepeatGroupSurfaceSelection<T> {
  if (!sameGroup(input.targetGroup, input.headingGroup)) {
    return { tableId: undefined, addControlId: undefined, reason: 'heading-mismatch' };
  }

  let tableId: T | undefined;
  for (const node of input.following) {
    if (node.kind === 'heading') break;
    if (!node.visible) continue;
    if (node.kind === 'table' && tableId == null) {
      tableId = node.id;
      continue;
    }
    if (node.kind === 'add' && tableId != null) {
      return { tableId, addControlId: node.id, reason: 'surface' };
    }
  }

  if (tableId != null) {
    return { tableId, addControlId: undefined, reason: 'surface-without-add' };
  }
  return { tableId: undefined, addControlId: undefined, reason: 'table-not-found' };
}
