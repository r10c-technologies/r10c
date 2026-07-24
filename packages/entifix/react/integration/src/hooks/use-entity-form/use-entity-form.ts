'use client';

import { describeEntityColumns, type Entity } from '@r10c/entifix-ts-core';
import { useCallback, useMemo, useState } from 'react';

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

  const [values, setValues] = useState<EntityFormValues>(seed);
  const [submitted, setSubmitted] = useState(false);

  const setField = useCallback((name: string, value: string) => {
    setValues(previous => ({ ...previous, [name]: value }));
  }, []);

  const errors = useMemo(
    () => validateEntityDraft(descriptors, values, validate),
    [descriptors, values, validate],
  );

  const submit = useCallback(() => {
    setSubmitted(true);
    if (
      Object.keys(validateEntityDraft(descriptors, values, validate)).length ===
      0
    ) {
      void onSubmit(values);
    }
  }, [descriptors, values, validate, onSubmit]);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(seed),
    [values, seed],
  );

  // Errors stay hidden until the first submit so a pristine form does not open
  // covered in "required" messages.
  return { values, errors: submitted ? errors : {}, setField, submit, isDirty };
}
