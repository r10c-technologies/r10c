'use client';

import { Configuration } from '@r10c/business-ts-configuration';
import {
  EntityField,
  EntityForm,
  TextInput,
  useT,
} from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import type { EntifixError } from '@r10c/entifix-ts-core';

export interface ConfigurationFormProps {
  entity?: Configuration;
  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  error?: EntifixError;
  onSave: (entity: Configuration) => void;
  onDelete?: () => void;
  backHref?: string;
}

/**
 * Create/update form for one configuration parameter. A thin wrapper over the
 * agnostic {@link EntityForm}, which derives every field from the entity's
 * metadata; what is left here is reconstructing the instance at submit and two
 * rules the generic form cannot know about.
 *
 * **Secrets are write-only.** A secret's value never comes back from the service,
 * so the field seeds blank with a "unchanged" placeholder, and submitting it blank
 * leaves the stored credential alone. The service enforces this — the form only
 * has to avoid *looking* like the value is empty, and avoid sending an empty
 * string that a reader would mistake for an intentional blanking.
 *
 * **The audit stamps are shown, not edited.** They are ordinary writable members
 * (`readonly` metadata would drop them from the wire in both directions, so the
 * table could not display them either), so the inputs are hidden here and the
 * service overwrites whatever arrives.
 */
export function ConfigurationForm({
  entity,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  onSave,
  onDelete,
  backHref,
}: ConfigurationFormProps) {
  const et = useT('entity');
  const st = useT('shell');
  const isSecret = entity?.isSecret === true;

  const form = useEntityForm<Configuration>({
    entityConstructor: Configuration,
    entity,
    onSubmit: values => {
      const target = new Configuration();
      target.id = entity?.id;
      target.service = values.service;
      target.groupName = values.groupName;
      target.key = values.key;
      target.isSecret = values.isSecret === 'true';

      // Blank on a secret means "keep what is stored", so the member is left
      // undefined rather than sent as an empty string — the serializer omits
      // undefined, and the service reads its absence as "unchanged".
      target.value = isSecret && values.value === '' ? undefined : values.value;

      onSave(target);
    },
  });

  return (
    <EntityForm<Configuration>
      entityConstructor={Configuration}
      entity={entity}
      mode="edit"
      values={form.values}
      onFieldChange={form.setField}
      errors={form.errors}
      formError={form.formError}
      onSubmit={form.submit}
      onDelete={onDelete}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      // `entity` is undefined until the record lands, so testing it alone
      // titled a loading edit form "New" and then relabelled it (#139).
      title={et(
        entity || isLoading
          ? 'configuration.form.editTitle'
          : 'configuration.form.newTitle',
      )}
    >
      <EntityField<Configuration> field="id" hidden />
      <EntityField<Configuration> field="updatedAt" hidden />
      <EntityField<Configuration> field="updatedBy" hidden />
      {isSecret ? (
        <EntityField<Configuration>
          field="value"
          render={({ value, setField, id }) => (
            <>
              {/* `TextInput`, not a bare <input>: every other field in this
                  form is one, and a raw element renders unstyled and without
                  the design system's focus ring. */}
              <TextInput
                id={id}
                type="password"
                value={value}
                placeholder={st(
                  'systemManagement.configuration.secretPlaceholder',
                )}
                aria-describedby={`${id}-hint`}
                onChange={event => setField('value', event.target.value)}
              />
              {/* The hint is what makes the blank field readable as "unchanged"
                  rather than "we lost your value". */}
              <small id={`${id}-hint`}>
                {st('systemManagement.configuration.secretHint')}
              </small>
            </>
          )}
        />
      ) : null}
    </EntityForm>
  );
}
