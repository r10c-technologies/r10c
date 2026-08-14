'use client';

import { Configuration } from '@r10c/business-ts-configuration';
import { EntityTable } from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import type { EntityId } from '@r10c/entifix-ts-core';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';

import { useSystemManagementAdapters } from '../system-management-context';

export const CONFIGURATION_LIST_HREF = '/system/configuration';

export interface ConfigurationListClientPageProps {
  /**
   * Overrides where a row links to. A workspace tab passes its own builder to
   * open the record as a tab; a routed page takes the default paths.
   */
  hrefFor?: (id: EntityId) => string;
}

/**
 * The configuration list.
 *
 * No bespoke organism: `EntityTable` builds every column from the entity's own
 * accessor metadata, labels included, so a table for this entity is the metadata
 * plus a link builder. That is also why there is no
 * `implementation/system-management` package — there would be nothing in it.
 */
export function ConfigurationListClientPage({
  hrefFor,
}: ConfigurationListClientPageProps = {}) {
  const { configurationRest, configurationStore } =
    useSystemManagementAdapters();
  // Only the *defaults* are prefixed: a caller that supplies its own `hrefFor`
  // (a workspace tab addressing itself) owns the shape of what it passes.
  const withLocale = useLocaleHref();

  const pager = useDataLoading({
    uc: loadUCFactory<Configuration>(),
    ctx: Context.merge(configurationStore, configurationRest),
  });

  return (
    <EntityTable
      entityConstructor={Configuration}
      {...pager}
      hrefFor={
        hrefFor ??
        (id => withLocale(`${CONFIGURATION_LIST_HREF}/${String(id)}`))
      }
      newHref={withLocale(`${CONFIGURATION_LIST_HREF}/new`)}
    />
  );
}
