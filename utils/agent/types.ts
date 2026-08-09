export type AgentGroupKind = 'single' | 'repeatable' | 'aggregate' | 'material';

export interface AgentTargetField {
  targetId: string;
  index: number;
  rowIndex?: number;
  columnId?: string;
  label: string;
  currentValue: string;
  required: boolean;
  protected: boolean;
  kind: 'text' | 'file';
  options: string[];
  placeholder: string;
  formatHints: string[];
  forbiddenCharacters: string[];
  maxLength?: number;
}

export interface AgentFieldRow {
  rowIndex: number;
  fields: AgentTargetField[];
}

export interface AgentFieldGroup {
  groupId: string;
  label: string;
  kind: AgentGroupKind;
  columns: Array<{ columnId: string; label: string }>;
  fields: AgentTargetField[];
  rows: AgentFieldRow[];
}

export interface AgentPageSnapshot {
  pageKey: string;
  url: string;
  title: string;
  stepText: string;
  instructions: string[];
  groups: AgentFieldGroup[];
  capturedAt: number;
}

export interface AgentPlannedValue {
  targetId: string;
  value: string;
  evidenceFields: string[];
  confidence: number;
  needsReview: boolean;
  reason: string;
}

export interface AgentAddRowsAction {
  actionId: string;
  type: 'add_rows';
  groupId: string;
  count: number;
  confidence: number;
  reason: string;
}

export interface AgentFillFieldAction extends AgentPlannedValue {
  actionId: string;
  type: 'fill_field';
  sourceRecordId: string;
}

export interface AgentFillRowAction {
  actionId: string;
  type: 'fill_row';
  groupId: string;
  rowIndex: number;
  sourceRecordId: string;
  values: AgentPlannedValue[];
}

export interface AgentSelectAction extends AgentPlannedValue {
  actionId: string;
  type: 'select';
  sourceRecordId: string;
}

export interface AgentUploadAction {
  actionId: string;
  type: 'upload';
  targetId: string;
  fileRecordId: string;
  confidence: number;
  needsReview: true;
  reason: string;
}

export type AgentPlannedAction =
  | AgentAddRowsAction
  | AgentFillFieldAction
  | AgentFillRowAction
  | AgentSelectAction
  | AgentUploadAction;

export interface AgentReviewItem {
  reviewId: string;
  targetId?: string;
  actionId?: string;
  message: string;
}

export interface AgentPagePlan {
  version: 1;
  pageKey: string;
  snapshotFingerprint: string;
  profileFingerprint: string;
  actions: AgentPlannedAction[];
  reviewItems: AgentReviewItem[];
}

export type AgentPhase =
  | 'observing'
  | 'planning'
  | 'validating'
  | 'preparing'
  | 'executing'
  | 'verifying'
  | 'repairing'
  | 'paused'
  | 'complete';

export interface AgentActionResult {
  actionId: string;
  targetId?: string;
  status: 'verified' | 'manual' | 'review' | 'failed' | 'skipped';
  observed: string;
  reason: string;
  retryable?: boolean;
  updatedAt: number;
}

export interface AgentCheckpoint {
  pageKey: string;
  phase: AgentPhase;
  plan?: AgentPagePlan;
  snapshotFingerprint?: string;
  profileFingerprint?: string;
  nextActionIndex: number;
  results: AgentActionResult[];
  retries: Record<string, number>;
  manualOverrides: Record<string, string>;
  cached?: boolean;
  error?: string;
  updatedAt: number;
}
