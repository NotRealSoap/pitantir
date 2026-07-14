/** Client-safe DTOs — do not import @pitantir/db in `"use client"` pages (pulls Node postgres). */

export type PublicAccountDto = {
  id: string;
  mcUuid: string | null;
  mcUsername: string;
  displayName: string | null;
  enabled: boolean;
  watchlisted: boolean;
  priority: number;
  scanIntervalSeconds: number;
  nextScanAt: string | Date;
  lastSuccessScanAt: string | Date | null;
  lastFailureScanAt: string | Date | null;
  lastHypixelOnline?: boolean | null;
  lastHypixelOnlineAt?: string | Date | null;
  lastPresenceSource?: string | null;
  lastSessionGame?: string | null;
  lastInventoryHash?: string | null;
  lastInventoryChangedAt?: string | Date | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
};

export type PublicScanSummaryDto = {
  id: string;
  accountId: string;
  mcUsername?: string | null;
  status: string;
  triggeredBy: string;
  processingStatus: string;
  createdAt: string | Date;
  observedAt: string | Date | null;
  itemCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawInventoryHash?: string | null;
};

/** Permissive list row shape from /api/items — keep loose so UI stays compile-stable. */
export type ItemListRowDto = {
  id: string;
  displayName: string | null;
  primaryNonce: string | null;
  category: string;
  identityConfidence: string;
  updatedAt: string | Date;
  locationKnown?: boolean;
  currentAccountUsername?: string | null;
  currentAccountId?: string | null;
  [key: string]: unknown;
};

/** Permissive item detail from /api/items/[id]. */
export type ItemDetailDto = {
  item: Record<string, unknown> & {
    id: string;
    displayName: string | null;
    primaryNonce: string | null;
    category: string;
    identityConfidence: string;
    status: string;
  };
  identifiers?: Array<Record<string, unknown>>;
  observations?: Array<Record<string, unknown>>;
  locationPeriods?: Array<Record<string, unknown>>;
  locationEvents?: Array<Record<string, unknown>>;
  periods?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  currentLocation?: Record<string, unknown> | null;
  [key: string]: unknown;
};
