import type { FormFieldInfo, MatchResult } from './matcher';
import type { RepeatableRecordPlan } from './repeatable-records';
import type {
  ApplicationTaskHistoryEntry,
  ApplicationTaskPauseReason,
} from './application-tasks';

export type PageMarkerStatus = 'verified' | 'review' | 'mismatch';

export interface PageMarkerItem {
  index: number;
  fingerprint?: string;
  status: PageMarkerStatus;
  message?: string;
}

export interface PageAnalysisAiState {
  configured: boolean;
  mode: 'enhanced' | 'fallback';
  attempted: boolean;
  cached: boolean;
  reviewed: number;
  error: string;
}

export interface ApplicationPageAnalysis {
  pageKey: string;
  pageLabel: string;
  pageUrl: string;
  pageSignature: string;
  fields: FormFieldInfo[];
  matches: MatchResult[];
  markers: PageMarkerItem[];
  checkedIndexes: number[];
  repeatPlan: RepeatableRecordPlan;
  ai: PageAnalysisAiState;
  capturedAt: number;
}

export interface ApplicationRunnerCheckpoint {
  status: 'running' | 'paused' | 'complete' | 'stopped';
  lastPageKey?: string;
  history: ApplicationTaskHistoryEntry[];
  pauseReason?: ApplicationTaskPauseReason;
  confirmedMaterialPageKey?: string;
  resumeAfter?: number;
  updatedAt: number;
}
