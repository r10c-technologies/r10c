'use client';

import type { EntityFieldDescriptor } from '@r10c/entifix-ts-core';
import { useCallback, useMemo } from 'react';

import { useTranslateKey } from './i18n-context';

/**
 * Resolves each descriptor's `labelKey` against the active catalog, leaving the
 * declared `label` in place for members that have no key yet.
 *
 * Done here rather than in `describeEntityColumns` because the same descriptors
 * are the server-side filter allowlist, where a translated label would be
 * meaningless — and because `entifix:core` cannot reach the i18n layer.
 */
export function useLocalizedDescriptors<TDescriptor extends EntityFieldDescriptor>(
  descriptors: readonly TDescriptor[],
): TDescriptor[] {
  const translate = useTranslateKey();

  return useMemo(
    () =>
      descriptors.map(descriptor =>
        descriptor.labelKey === undefined
          ? descriptor
          : { ...descriptor, label: translate(descriptor.labelKey) },
      ),
    [descriptors, translate],
  );
}

/**
 * Reads one value of an enum member. Falls back to the raw value when the
 * member declared no vocabulary prefix, which is what a `status` of `active`
 * used to render as everywhere.
 */
export function useEnumLabel(): (
  descriptor: EntityFieldDescriptor,
  value: string,
) => string {
  const translate = useTranslateKey();

  return useCallback(
    (descriptor, value) =>
      descriptor.enumLabelKey === undefined
        ? value
        : translate(`${descriptor.enumLabelKey}.${value}`),
    [translate],
  );
}

/**
 * Renders a failed request in the reader's language.
 *
 * Services answer with `{ error, code, detail }`, and the rest client carries
 * the `code` onto `EntifixError.details`. Falling back to `message` keeps a
 * failure that predates the vocabulary — or one raised client-side — readable
 * rather than blank.
 */
export function useErrorMessage(): (error: {
  message: string;
  details?: Record<string, unknown>;
}) => string {
  const translate = useTranslateKey();

  return useCallback(
    error => {
      const code = error.details?.['code'];
      return typeof code === 'string' ? translate(`errors:${code}`) : error.message;
    },
    [translate],
  );
}
