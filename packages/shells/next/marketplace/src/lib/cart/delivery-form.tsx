'use client';

import {
  Select,
  Stack,
  SubmitButton,
  Text,
  TextInput,
} from '@entifix/react-controls/primitives';
import { GUATEMALA_DEPARTAMENTOS } from '@r10c/business-ts-order-contracts';
import { useActionState } from 'react';

import { placeOrder } from './checkout-action';
import {
  type ContactField,
  contactFieldName,
  EMPTY_CHECKOUT_FORM,
} from './delivery-contact';

/** The copy the form shows, resolved on the server in the buyer's locale. */
export interface DeliveryFormLabels {
  readonly legend: string;
  readonly intro: string;
  readonly optional: string;
  readonly chooseMunicipio: string;
  readonly place: string;
  readonly fields: Readonly<Record<ContactField, string>>;
  readonly hints: Readonly<Partial<Record<ContactField, string>>>;
  /** Each error code the contact can answer, as a sentence. */
  readonly errors: Readonly<Record<string, string>>;
}

/**
 * Each field's WCAG 1.3.5 purpose, so a browser can fill it in. The form makes
 * no attempt of its own to remember the buyer (ADR 0076 §2).
 */
const AUTOCOMPLETE: Readonly<Record<ContactField, string>> = {
  name: 'name',
  phone: 'tel-national',
  email: 'email',
  municipio: 'address-level2',
  zona: 'off',
  addressLine: 'address-line1',
  reference: 'address-line2',
};

const INPUT_TYPE: Readonly<Partial<Record<ContactField, string>>> = {
  phone: 'tel',
  email: 'email',
  zona: 'number',
};

const OPTIONAL: ReadonlySet<ContactField> = new Set(['zona', 'reference']);

const idOf = (field: ContactField) => `delivery-${field}`;

/**
 * The review step's "Entrega y contacto" fieldset and its Place order button,
 * one form. Posted with `useActionState`, so a refused contact comes back with
 * what was typed and an error beside each field.
 *
 * The municipio is **one native select** grouped by departamento: the
 * departamento follows from the choice, so no script and no second round trip
 * is needed to narrow the list.
 */
export function DeliveryForm({
  locale,
  reviewed,
  tenders,
  retry,
  labels,
}: {
  readonly locale: string;
  readonly reviewed: string;
  readonly tenders: Readonly<Record<string, string>>;
  /** The review was reached from a failed start, whose ticket it reuses. */
  readonly retry: boolean;
  readonly labels: DeliveryFormLabels;
}) {
  const [state, action] = useActionState(placeOrder, EMPTY_CHECKOUT_FORM);

  const field = (name: ContactField) => {
    const error = state.errors[name];
    const hint = labels.hints[name];
    const described = [
      hint === undefined ? undefined : `${idOf(name)}-hint`,
      error === undefined ? undefined : `${idOf(name)}-error`,
    ]
      .filter(Boolean)
      .join(' ');
    const common = {
      id: idOf(name),
      name: contactFieldName(name),
      autoComplete: AUTOCOMPLETE[name],
      defaultValue: state.values[name] ?? '',
      'aria-invalid': error === undefined ? undefined : true,
      'aria-describedby': described === '' ? undefined : described,
      required: !OPTIONAL.has(name),
    } as const;
    return (
      <div key={name} className="flex flex-col gap-3xs">
        <label htmlFor={idOf(name)} className="text-step--1 font-semibold">
          {labels.fields[name]}
          {OPTIONAL.has(name) ? ` ${labels.optional}` : null}
        </label>
        {hint === undefined ? null : (
          <Text tone="muted" id={`${idOf(name)}-hint`}>
            {hint}
          </Text>
        )}
        {name === 'municipio' ? (
          // Keyed by the submitted value, so a refused submit re-renders the
          // choice the buyer made rather than the first option.
          <Select key={state.values.municipio ?? ''} {...common}>
            <option value="">{labels.chooseMunicipio}</option>
            {GUATEMALA_DEPARTAMENTOS.map(departamento => (
              <optgroup key={departamento.code} label={departamento.name}>
                {departamento.municipios.map(municipio => (
                  <option key={municipio.code} value={municipio.code}>
                    {municipio.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        ) : (
          <TextInput
            key={state.values[name] ?? ''}
            type={INPUT_TYPE[name] ?? 'text'}
            {...(name === 'zona' ? { min: 1, max: 25, step: 1 } : {})}
            {...common}
          />
        )}
        {error === undefined ? null : (
          <p
            className="text-step--1 m-0 text-danger"
            id={`${idOf(name)}-error`}
            data-testid={`delivery-error-${name}`}
          >
            {labels.errors[error] ?? error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form action={action} noValidate data-testid="delivery-form">
      <Stack gap="m">
        <fieldset className="flex flex-col gap-s">
          <legend className="text-step-1 font-semibold">{labels.legend}</legend>
          <Text tone="muted">{labels.intro}</Text>
          {field('name')}
          {field('phone')}
          {field('email')}
          {field('municipio')}
          {field('zona')}
          {field('addressLine')}
          {field('reference')}
        </fieldset>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="reviewed" value={reviewed} />
        {retry ? <input type="hidden" name="retry" value="1" /> : null}
        {Object.entries(tenders).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <SubmitButton data-testid="checkout" className="touch-target">
          {labels.place}
        </SubmitButton>
      </Stack>
    </form>
  );
}
