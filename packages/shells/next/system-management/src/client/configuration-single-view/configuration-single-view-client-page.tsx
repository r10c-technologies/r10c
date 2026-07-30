'use client';

import { Configuration } from '@r10c/business-ts-configuration';
import {
  useEntityMutation,
  useEntityRecord,
} from '@r10c/entifix-react-integration';
import {
  type ConfigurationRepositoryTag,
  deleteUCFactory,
  type EntityRepositoryTag,
  getUCFactory,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { ConfigurationForm } from '../configuration-form';
import { CONFIGURATION_LIST_HREF } from '../configuration-list/configuration-list-client-page';
import { NEW_SLUG, slugToEntityId } from '../slug';
import { useSystemManagementAdapters } from '../system-management-context';

type ConfigurationContext = EntityRepositoryTag | ConfigurationRepositoryTag;

export interface ConfigurationSingleViewClientPageProps {
  /** Omit to read the slug from the route — a workspace tab passes it directly. */
  slug?: string;
  onSaved?: () => void;
  onDeleted?: () => void;
}

/**
 * Composition root for one configuration parameter.
 *
 * Dual-host, like the catalog single views: with the optional props it renders
 * inside a workspace tab, and without them it behaves as a routed page.
 */
export function ConfigurationSingleViewClientPage({
  slug,
  onSaved,
  onDeleted,
}: ConfigurationSingleViewClientPageProps = {}) {
  const { configurationRest, configurationStore } =
    useSystemManagementAdapters();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(slug ?? params.slug);

  const ctx = Context.merge(configurationStore, configurationRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<Configuration, ConfigurationContext>({
    uc: getUCFactory<Configuration>(),
    ctx,
    id,
  });

  const {
    save,
    remove,
    isSaving,
    isDeleting,
    error: writeError,
  } = useEntityMutation<Configuration, ConfigurationContext>({
    saveUc: saveUCFactory<Configuration>(),
    deleteUc: deleteUCFactory<Configuration>(),
    ctx,
  });

  const afterSave = onSaved ?? (() => router.push(CONFIGURATION_LIST_HREF));
  const afterDelete = onDeleted ?? (() => router.push(CONFIGURATION_LIST_HREF));

  const handleSave = async (row: Configuration) => {
    if (await save(row)) {
      afterSave();
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      afterDelete();
    }
  };

  return (
    <ConfigurationForm
      // Reseeds the draft when the record arrives — `useEntityForm` seeds once.
      key={String(entity?.id ?? NEW_SLUG)}
      entity={entity}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={loadError ?? writeError}
      onSave={handleSave}
      onDelete={id == null ? undefined : handleDelete}
      backHref={CONFIGURATION_LIST_HREF}
    />
  );
}
