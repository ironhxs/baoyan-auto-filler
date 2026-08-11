import type { AgentSourceRecord } from './profile-retriever';
import type { AgentPagePlan, AgentPageSnapshot } from './types';

export interface AgentBatchPageInput {
  snapshot: AgentPageSnapshot;
  sourceRecords: AgentSourceRecord[];
  fileRecordIds?: string[];
}

export interface AgentBatchBlueprint {
  version: 1;
  applicationId: string;
  fingerprint: string;
  pages: AgentBatchPageInput[];
  capturedAt: number;
}

export interface AgentBatchPlan {
  version: 1;
  blueprintFingerprint: string;
  pagePlans: AgentPagePlan[];
  reviewItems: string[];
}
