'use client';

import {
  describeEntityColumns,
  type Entity,
  type EntityLinkSelection,
  seedEntityLinkSelection,
} from '@r10c/entifix-ts-core';
import { sharedFallbackI18n } from '@r10c/entifix-ts-i18n';
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useCallback, useContext, useMemo, useState } from 'react';
import { I18nContext, initReactI18next, useTranslation } from 'react-i18next';

import {
  composeEntityFormErrors,
  readFieldErrors,
  seedEntityDraft,
} from './use-entity-form.helpers';
import type {
  EntityFormValues,
  UseEntityFormOptions,
  UseEntityFormResult,
} from './use-entity-form.types';

/**
 * The write half of an entity form: holds the string draft and reports
 * metadata-derived validation, the counterpart to {@link useEntityRecord}
 * (which reads the record it seeds from).
 *
 * It stays out of the transport: it neither fetches nor saves. `onSubmit`
 * receives the validated draft, and the per-entity wrapper reconstructs the
 * domain entity and calls the mutation. The result plugs straight into the
 * agnostic `EntityForm` (`values`/`onFieldChange`/`errors`/`onSubmit`).
 *
 * TanStack Form owns the draft and the submission lifecycle; that is an
 * implementation detail, and the returned shape is deliberately the plain
 * `values`/`errors`/`setField`/`submit`/`isDirty` facade so `EntityForm` — which
 * renders native inputs and knows nothing about any form library — stays
 * agnostic. Fields are therefore never registered through `form.Field`; a
 * form-level validator reporting `{ fields }` reaches them anyway, because
 * `FormApi` creates meta for any field name an error arrives for.
 *
 * `revalidateLogic` is what makes a pristine form quiet: nothing validates until
 * the first submit, and every keystroke revalidates after it. Running one
 * validator under a single cause also keeps a fixed field from holding a stale
 * message left behind by another cause.
 *
 * The seed applies once, so a caller that loads its record after mount keys the
 * form by the record id to reseed — the same convention `EntityForm`'s wrappers
 * already follow.
 */
export function useEntityForm<TEntity extends Entity>({
  entityConstructor,
  entity,
  initialValues,
  schema,
  validate,
  onSubmit,
}: UseEntityFormOptions<TEntity>): UseEntityFormResult {
  const descriptors = useMemo(
    () => describeEntityColumns(entityConstructor, entity),
    [entityConstructor, entity],
  );
  const seed = useMemo(
    () => initialValues ?? seedEntityDraft(descriptors, entity),
    [descriptors, entity, initialValues],
  );

  // The relations the record already carries, so opening a loaded record needs no
  // label lookup and a save keeps whatever embedded shape it arrived in. Seeded
  // once, like the draft — a caller that loads late keys the form by record id.
  const [links, setLinks] = useState<EntityLinkSelection>(() =>
    seedEntityLinkSelection(descriptors, entity),
  );

  // Read straight from react-i18next rather than through the controls package:
  // both are `entifix:react`, and the boundary rule forbids a sideways import.
  // The provider a host mounts is the same React context either way — and with
  // no provider, react-i18next would reach for its uninitialized global and
  // render raw keys, so the shared default instance is passed explicitly.
  const provided = useContext(I18nContext);
  const { t } = useTranslation(
    'controls',
    provided === undefined
      ? { i18n: sharedFallbackI18n([initReactI18next]) }
      : {},
  );
  const messages = useMemo(
    () => ({
      required: (field: string) => t('validation.required', { field }),
      number: (field: string) => t('validation.number', { field }),
      date: (field: string) => t('validation.date', { field }),
      option: (field: string) => t('validation.option', { field }),
    }),
    [t],
  );

  // A schema's message is authored as a catalog key (`validation.minLength`),
  // because a rule written in one language would reach the user untranslated —
  // the one thing the i18n gate exists to prevent. `defaultValue` keeps an
  // unkeyed literal readable instead of rendering the key back at the user, and
  // `field` is offered as a parameter so a message can name its own label.
  // The same cast `useTranslateKey` makes in the controls package, for the same
  // reason: a key only known at runtime cannot be checked against the catalogs.
  const translateKey = t as unknown as (
    key: string,
    params?: Record<string, unknown>,
  ) => string;
  const translateIssue = useCallback(
    (message: string, field: string | undefined) =>
      translateKey(message, {
        defaultValue: message,
        field: descriptors.find(entry => entry.name === field)?.label ?? field,
      }),
    [translateKey, descriptors],
  );

  const form = useForm({
    defaultValues: seed,
    // Quiet until the first submit, then revalidate on every change — the
    // behaviour the hand-rolled `submitted` flag used to produce.
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: ({ value }: { value: EntityFormValues }) => {
        const { fields, form } = composeEntityFormErrors({
          descriptors,
          values: value,
          messages,
          schema,
          translateIssue,
          validate,
        });

        if (Object.keys(fields).length === 0 && form === undefined)
          return undefined;
        // `{ fields }` is how a form-level validator addresses individual
        // fields; the bare `form` message is what has no field to sit under.
        return { form, fields };
      },
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const values = useStore(form.store, state => state.values);
  const fieldMeta = useStore(form.store, state => state.fieldMeta);
  const formError = useStore(form.store, state => state.errorMap.onDynamic);
  // `isDefaultValue`, not `isDirty`: the draft is dirty when it *differs* from
  // its seed, so editing a field and typing the seed value back is not a change
  // the workspace should autosave.
  const isDefaultValue = useStore(form.store, state => state.isDefaultValue);

  const errors = useMemo(() => readFieldErrors(fieldMeta), [fieldMeta]);

  const submit = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  // Both halves of a pick, in one call: the id the draft persists and the
  // instance only memory holds.
  const setLink = useCallback(
    (name: string, picked: Entity | undefined) => {
      setLinks(current => ({ ...current, [name]: picked }));
      form.setFieldValue(name, picked?.id == null ? '' : String(picked.id));
    },
    [form],
  );

  return {
    values,
    errors,
    formError: typeof formError === 'string' ? formError : undefined,
    setField: form.setFieldValue,
    links,
    setLink,
    submit,
    isDirty: !isDefaultValue,
  };
}
