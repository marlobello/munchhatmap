/** Shared types used across importHandler sub-modules. */

export type Verbosity = 'standard' | 'verbose' | 'debug';

export interface FailedMessage {
  url: string;
  reason: 'no_image' | 'no_location';
  username: string;
  debugInfo?: string[];
}

export interface ScanResult {
  imported: number;
  duplicates: number;
  totalScanned: number;
  failed: FailedMessage[];
}
