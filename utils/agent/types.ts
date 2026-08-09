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

