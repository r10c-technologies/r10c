'use client';

import { describeEntityColumns, type Entity } from '@r10c/entifix-ts-core';
import { sharedFallbackI18n } from '@r10c/entifix-ts-i18n';
import { useCallback, useContext, useMemo, useState } from 'react';
import {
  I18nContext,
  initReactI18next,
  useTranslation,
} from 'react-i18next';

import {
  seedEntityDraft,
  validateEntityDraft,
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
 * The draft is a flat `Record<string, string>`, so a bare `useState` owns it —
 * a form-state library would add a heavy dependency (and, via its
 * `use-sync-external-store` shim, a prerender-time `require` the app bundler
 * rejects) for no gain over this. The seed applies once, so a caller that loads
 * its record after mount keys the form by the record id to reseed — the same
 * convention `EntityForm`'s wrappers already follow.
 */
export function useEntityForm<TEntity extends Entity>({
  entityConstructor,
  entity,
  initialValues,
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

  const [values, setValues] = useState<EntityFormValues>(seed);
  const [submitted, setSubmitted] = useState(false);

  const setField = useCallback((name: string, value: string) => {
    setValues(previous => ({ ...previous, [name]: value }));
  }, []);

  const errors = useMemo(
    () => validateEntityDraft(descriptors, values, messages, validate),
    [descriptors, values, messages, validate],
  );

  const submit = useCallback(() => {
    setSubmitted(true);
    if (
      Object.keys(validateEntityDraft(descriptors, values, messages, validate))
        .length === 0
    ) {
      void onSubmit(values);
    }
  }, [descriptors, values, messages, validate, onSubmit]);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(seed),
    [values, seed],
  );

  // Errors stay hidden until the first submit so a pristine form does not open
  // covered in "required" messages.
  return { values, errors: submitted ? errors : {}, setField, submit, isDirty };
}
