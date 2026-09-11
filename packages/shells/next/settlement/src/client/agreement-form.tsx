'use client';

import {
  Agreement,
  type ChannelCommissionRates,
} from '@r10c/business-ts-settlement-management';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import {
  type EntifixError,
  type EntityMetadataSource,
  readDraftString,
} from '@r10c/entifix-ts-core';
import { useEntityAffordances } from '@r10c/shells-next-common';
import { useState } from 'react';

import { ChannelRateEditor } from './channel-rate-editor';

export interface AgreementFormProps {
  entity?: Agreement;
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  /** Where this caller's affordances come from — the served descriptor. */
  metadataSource?: EntityMetadataSource;
  onSave: (entity: Agreement) => void;
  backHref?: string;
}

/**
 * Create/update form for one vendor's commercial terms.
 *
 * ⚠️ **Hand-written rather than generated, and the per-channel rate is the whole
 * reason.** `makeEntityCrud` derives a form from the entity's metadata, and the
 * metadata cannot describe a map: the framework's member types are scalars, two
 * relation shapes and two collections, and a draft value is a string or a list
 * of row drafts. `channelCommissionBasisPoints` is therefore declared
 * `type: 'number'` over an object, which a generated form seeds as
 * `"[object Object]"`, fails validation on, and writes back as `NaN`. Hiding the
 * field does not rescue it either — a hidden member still round-trips through
 * the draft, and a non-string value does not survive the trip.
 *
 * So the field is hidden and {@link ChannelRateEditor} is rendered in its place,
 * and this form owns its submit rebuild the way `ConfigurationForm` does. Every
 * other settlement screen is generated; this is the one that cannot be.
 *
 * ⚠️ **`mode` follows the caller's real affordances, not a flag this component
 * chooses.** No role holds `agreement:write` — setting what the platform charges
 * a vendor is an operator act, and an `admin` who could write it could set their
 * own commission to zero. The served `$metadata` descriptor is what says so, and
 * the page above passes it through (ADR 0033).
 *
 * There is no delete. An agreement is a commercial record with settled sales
 * priced against it; superseding one means writing a later `effectiveFrom`, not
 * removing the terms history was made under.
 */
export function AgreementForm({
  entity,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  metadataSource,
  onSave,
  backHref,
}: AgreementFormProps) {
  const et = useT('entity');
  const st = useT('shell');
  const affordances = useEntityAffordances(Agreement, metadataSource);

  // Absent metadata keeps the pre-ADR-0026 behaviour, so a host that passes no
  // source is untouched; present metadata is authoritative, because it is what
  // the route behind the Save button will actually enforce.
  const mayWrite =
    affordances.metadata === undefined ||
    affordances.metadata.actions.includes('write');

  // Held here rather than in the draft, because the draft cannot carry an
  // object. The page keys this component on the record id, so the initializer
  // re-runs when a loaded record arrives — the same convention the form's own
  // seed follows. See the note on `ChannelRateEditor`.
  const [rates, setRates] = useState<ChannelCommissionRates>(
    () => entity?.channelCommissionBasisPoints ?? {},
  );

  const form = useEntityForm<Agreement>({
    entityConstructor: Agreement,
    entity,
    // ⚠️ **`channelCommissionBasisPoints` is scoped *out* of the draft, not
    // merely hidden from it.** A hidden member keeps its validation rule — the
    // rule and the input are separate facts — and this member's rule is
    // `type: 'number'`, which a map seeds into as `"[object Object]"` and then
    // fails on. The symptom is the worst kind: Save does nothing and says
    // nothing, because the error belongs to a field no longer on screen.
    //
    // `fields` drops it from the descriptors entirely, so it has no seed and no
    // rule; the slot below re-adds it as a *virtual* field, and the editor holds
    // its value. Found by the spec beside this file, on a record that carried a
    // rate — the form submitted perfectly well on one that did not.
    fields: ['id', 'vendorId', 'commissionBasisPoints', 'effectiveFrom'],
    onSubmit: values => {
      const target = new Agreement();
      target.id = entity?.id;
      target.vendorId = readDraftString(values, 'vendorId');
      target.commissionBasisPoints = Number(
        readDraftString(values, 'commissionBasisPoints'),
      );

      const effectiveFrom = readDraftString(values, 'effectiveFrom');
      target.effectiveFrom =
        effectiveFrom === '' ? undefined : new Date(effectiveFrom);

      // An empty map is written **absent**, not as `{}`. An agreement with no
      // per-channel terms has none; a stored empty object would read as "there
      // are overrides here" to anyone inspecting the record, and `commissionFor`
      // treats the two identically anyway.
      target.channelCommissionBasisPoints =
        Object.keys(rates).length === 0 ? undefined : rates;

      onSave(target);
    },
  });

  return (
    <EntityForm<Agreement>
      entityConstructor={Agreement}
      entity={entity}
      mode={mayWrite ? 'edit' : 'read'}
      values={form.values}
      onFieldChange={form.setField}
      errors={form.errors}
      formError={form.formError}
      onSubmit={form.submit}
      {...affordances}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      // `entity` is undefined until the record lands, so testing it alone
      // titled a loading edit form "New" and then relabelled it (#139).
      title={et(
        entity || isLoading
          ? 'agreement.form.editTitle'
          : 'agreement.form.newTitle',
      )}
    >
      <EntityField<Agreement> field="id" hidden />
      <EntityField<Agreement>
        field="channelCommissionBasisPoints"
        label={et('agreement.fields.channelCommissionBasisPoints')}
        render={({ id }) => (
          <ChannelRateEditor
            id={id}
            value={rates}
            disabled={!mayWrite}
            onChange={setRates}
          />
        )}
        readRender={() => (
          <span>
            {Object.keys(rates).length === 0
              ? st('settlement.agreement.noChannelRates')
              : Object.entries(rates)
                  .map(([type, points]) => `${type}: ${points}`)
                  .join(' · ')}
          </span>
        )}
      />
    </EntityForm>
  );
}
