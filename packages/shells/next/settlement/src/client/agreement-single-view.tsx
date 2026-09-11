'use client';

import { Agreement } from '@r10c/business-ts-settlement-management';
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
import type { EntityCrudSingleViewProps } from '@r10c/shells-next-common';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { AGREEMENT_SURFACE } from '../settlement-surfaces';
import { AgreementForm } from './agreement-form';
import { useSettlementAdapters } from './settlement-context';
import { SETTLEMENT_METADATA } from './settlement-crud';

type AgreementContext = EntityRepositoryTag | ConfigurationRepositoryTag;

/** What a routed page and a workspace tab both address a new record as. */
const NEW_SLUG = 'new';

const slugToEntityId = (slug: string): string | undefined =>
  slug === NEW_SLUG ? undefined : slug;

/**
 * Composition root for one vendor's agreement.
 *
 * Dual-host, like every other single view: with the optional props it renders
 * inside a workspace tab, and without them it behaves as a routed page.
 *
 * ⚠️ **Hand-written because the form under it has to be**, not because this
 * record needs anything special. The load, the save and the navigation are the
 * same three moves `makeEntityCrud` makes; what the generator cannot do is hand
 * the form a bespoke control for a map-valued member. See {@link AgreementForm}.
 *
 * ⚠️ **The `draft` prop is accepted and ignored.** The autosaved draft holds
 * JSON round-trippable values (ADR 0032), and the per-channel rate map is held
 * outside the draft for exactly that reason — so persisting the rest of this
 * form while silently dropping the rates would restore a tab to a state that
 * looks complete and is not. Losing the whole draft is worse in a small way and
 * honest; restoring half of it is better in a small way and a lie.
 */
export function AgreementSingleViewClientPage({
  slug,
  onSaved,
}: EntityCrudSingleViewProps = {}) {
  const { agreementRest, configurationStore } = useSettlementAdapters();
  const router = useRouter();
  // Every internal navigation carries the locale. Unprefixed, each one is
  // bounced by the middleware — and the form's back link is a plain `<a>`, so
  // that redirect rides on top of a full document load.
  const withLocale = useLocaleHref();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(slug ?? params.slug);

  const ctx = Context.merge(configurationStore, agreementRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<Agreement, AgreementContext>({
    uc: getUCFactory<Agreement>(),
    ctx,
    id,
  });

  const {
    save,
    isSaving,
    error: writeError,
  } = useEntityMutation<Agreement, AgreementContext>({
    saveUc: saveUCFactory<Agreement>(),
    deleteUc: deleteUCFactory<Agreement>(),
    ctx,
  });

  const afterSave =
    onSaved ?? (() => router.push(withLocale(AGREEMENT_SURFACE.basePath)));

  const handleSave = async (row: Agreement) => {
    if (await save(row)) {
      afterSave();
    }
  };

  return (
    <AgreementForm
      // Reseeds the draft — and the rate editor's own state — when the record
      // arrives. `useEntityForm` seeds once, and so does a `useState`
      // initializer, so both depend on this key.
      key={String(entity?.id ?? NEW_SLUG)}
      entity={entity}
      isLoading={isLoading}
      isSaving={isSaving}
      error={loadError ?? writeError}
      metadataSource={SETTLEMENT_METADATA}
      onSave={handleSave}
      backHref={withLocale(AGREEMENT_SURFACE.basePath)}
    />
  );
}
