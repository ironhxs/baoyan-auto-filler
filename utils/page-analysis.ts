import type { FormFieldInfo, MatchResult } from './matcher';
import { isMeaningfullyFilled } from './local-matcher';
import { isPageValueConsistent } from './value-compare';
import { fieldFingerprint } from './field-fingerprint';
import type { RepeatableRecordPlan } from './repeatable-records';
import type {
  ApplicationTaskHistoryEntry,
  ApplicationTaskPauseReason,
} from './application-tasks';
import { semanticPageKey } from './page-identity';

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

/** Derive marker state from the current DOM fields and their cached matches. */
export function derivePageMarkers(fields: FormFieldInfo[], matches: MatchResult[]): PageMarkerItem[] {
  const matchByIndex = new Map(matches.map((match) => [match.index, match]));
  return fields.flatMap<PageMarkerItem>((field) => {
    const match = matchByIndex.get(field.index);
    const filled = isMeaningfullyFilled(field);
    if (match?.kind === 'file') {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: 'review',
        message: filled ? 'File value requires review' : 'File candidate requires review',
      }];
    }
    if (match && filled) {
      const allowSystemPrefix = field.selectionMode === 'dialog' || /出生地|籍贯|学校|院校|专业/.test(field.label ?? '');
      const consistent = isPageValueConsistent(field.value, match.value, allowSystemPrefix);
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: consistent ? 'verified' : 'mismatch',
        message: consistent ? 'Value matches cached data' : 'Value differs from cached data',
      }];
    }
    if (match) {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: match.confidence === 'high' ? 'verified' : 'review',
        message: match.confidence === 'high' ? 'High-confidence match pending fill' : 'Match requires review',
      }];
    }
    if (field.protected || filled) {
      return [{
        index: field.index,
        fingerprint: fieldFingerprint(field),
        status: 'review',
        message: field.protected ? `Protected: ${field.protectionReason || 'manual review required'}` : 'Existing value has no cached match',
      }];
    }
    return [];
  });
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

export function shouldReusePageAnalysis(
  analysis: ApplicationPageAnalysis | null | undefined,
  current: { url?: string; label?: string; signature?: string },
): boolean {
  if (!analysis) return false;
  return semanticPageKey(current) === analysis.pageKey;
}
