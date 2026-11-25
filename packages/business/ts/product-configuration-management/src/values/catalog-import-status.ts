import type { EnumTone } from '@entifix/core';

/**
 * What an import leaves its rows as: drafts to review, or released and on
 * sale in the same write (ADR 0084 §4).
 */
export const CatalogImportModes = ['draft', 'publish'] as const;

export type CatalogImportMode = (typeof CatalogImportModes)[number];

/**
 * How an import ended: every row written, or some refused. An import never
 * ends half-written for one row — a row is one unit of work — so there is no
 * third state to report.
 */
export const CatalogImportStatuses = ['completed', 'partial'] as const;

export type CatalogImportStatus = (typeof CatalogImportStatuses)[number];

export const CatalogImportStatusTones = {
  completed: 'success',
  partial: 'warning',
} as const satisfies Readonly<Record<CatalogImportStatus, EnumTone>>;
