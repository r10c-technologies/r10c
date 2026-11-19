'use client';

import {
  Select,
  Stack,
  SubmitButton,
  Text,
  TextInput,
} from '@entifix/react-controls/primitives';
import {
  FILLED_INPUT_PATTERN,
  GUATEMALA_DEPARTAMENTOS,
  PHONE_INPUT_PATTERN,
} from '@r10c/business-ts-order-contracts';
import { useActionState, useSyncExternalStore } from 'react';

import { placeOrder } from './checkout-action';
import { type Tender, tenderField } from './checkout-start';
import {
  type CheckoutFormState,
  type ContactField,
  contactFieldName,
  EMPTY_CHECKOUT_FORM,
} from './delivery-contact';

/** The copy the form shows, resolved on the server in the buyer's locale. */
export interface DeliveryFormLabels {
  readonly legend: string;
  readonly intro: string;
  /** The fiscal-identity group: its legend, what it is for, and each id type. */
  readonly tax: {
    readonly legend: string;
    readonly intro: string;
    readonly idTypes: Readonly<Record<'cf' | 'nit' | 'cui', string>>;
  };
  readonly optional: string;
  readonly chooseMunicipio: string;
  readonly place: string;
  readonly fields: Readonly<Record<ContactField, string>>;
  readonly hints: Readonly<Partial<Record<ContactField, string>>>;
  /** Each error code the contact can answer, as a sentence. */
  readonly errors: Readonly<Record<string, string>>;
  /** The payment choice, one group per seller (ADR 0076 §7). */
  readonly payment: {
    /** Each tender's name, as a radio's label. */
    readonly tender: Readonly<Record<Tender, string>>;
    /** A seller that takes one tender, stated rather than asked. */
    readonly only: Readonly<Record<Tender, string>>;
    /**
     * What each option means: a card while the provider is simulated, cash
     * on delivery, and a link the seller sends and confirms.
     */
    readonly hint: Readonly<Record<Tender, string>>;
    /** Said beside a seller whose tender the buyer has not chosen. */
    readonly required: string;
  };
}

/** One seller the buyer pays, and the tenders that seller takes. */
export interface PayableSeller {
  readonly vendorId: string;
  /** The group's legend, naming the seller, resolved on the server. */
  readonly legend: string;
  readonly offered: readonly Tender[];
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
  taxIdType: 'off',
  taxId: 'off',
  taxName: 'organization',
};

const INPUT_TYPE: Readonly<Partial<Record<ContactField, string>>> = {
  phone: 'tel',
  email: 'email',
  zona: 'number',
};

const OPTIONAL: ReadonlySet<ContactField> = new Set([
  'zona',
  'reference',
  // Consumidor final needs neither; the server asks for them once a NIT or a
  // CUI is chosen, and without script the browser cannot know which.
  'taxId',
  'taxName',
]);

/**
 * What the browser checks on its own when the form posts without script: the
 * same rules `contactProblems` applies, as patterns (#725). The email's is its
 * `type`, and the municipio's its `required`.
 */
const PATTERN: Readonly<Partial<Record<ContactField, string>>> = {
  name: FILLED_INPUT_PATTERN,
  phone: PHONE_INPUT_PATTERN,
  addressLine: FILLED_INPUT_PATTERN,
};

const subscribeNever = () => () => undefined;

/**
 * `false` in the server's HTML, `true` once React runs in the browser. Read
 * through `useSyncExternalStore`, so the first client render agrees with the
 * server's and hydration does not warn.
 */
const useHydrated = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

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
  sellers,
  retry,
  labels,
  initial = EMPTY_CHECKOUT_FORM,
}: {
  readonly locale: string;
  readonly reviewed: string;
  readonly sellers: readonly PayableSeller[];
  /** The review was reached from a failed start, whose ticket it reuses. */
  readonly retry: boolean;
  readonly labels: DeliveryFormLabels;
  /**
   * Where the form starts: empty, or — after a post without script that the
   * browser let through and the server refused — each field's error with
   * nothing typed, since the values are never carried back (`refusedReview`).
   */
  readonly initial?: CheckoutFormState;
}) {
  const [state, action] = useActionState(placeOrder, initial);
  const hydrated = useHydrated();

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
      className: 'w-full min-w-0',
      name: contactFieldName(name),
      autoComplete: AUTOCOMPLETE[name],
      defaultValue: state.values[name] ?? '',
      'aria-invalid': error === undefined ? undefined : true,
      'aria-describedby': described === '' ? undefined : described,
      required: !OPTIONAL.has(name),
      ...(PATTERN[name] === undefined
        ? {}
        : // The hint, when there is one, is what the browser's own message
          // adds; it says what a valid value looks like.
          {
            pattern: PATTERN[name],
            ...(hint === undefined ? {} : { title: hint }),
          }),
    } as const;
    return (
      <div key={name} className="flex min-w-0 flex-col gap-3xs">
        <label htmlFor={idOf(name)} className="text-step--1 font-semibold">
          {labels.fields[name]}
          {OPTIONAL.has(name) ? ` ${labels.optional}` : null}
        </label>
        {hint === undefined ? null : (
          <Text tone="muted" id={`${idOf(name)}-hint`}>
            {hint}
          </Text>
        )}
        {name === 'taxIdType' ? (
          <Select key={state.values.taxIdType ?? ''} {...common}>
            {(['cf', 'nit', 'cui'] as const).map(type => (
              <option key={type} value={type}>
                {labels.tax.idTypes[type]}
              </option>
            ))}
          </Select>
        ) : name === 'municipio' ? (
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

  /**
   * One seller's tender. Two tenders are a radio group with **none checked**
   * and a choice required; one is a sentence and a hidden field, because a
   * control with one option asks nothing (ADR 0076 §7).
   */
  const payment = (seller: PayableSeller) => {
    const id = `payment-${seller.vendorId}`;
    const missing = state.tendersMissing.includes(seller.vendorId);
    const [only] = seller.offered;
    return (
      <fieldset
        key={seller.vendorId}
        className="flex min-w-0 flex-col gap-2xs"
        data-testid={id}
        aria-describedby={missing ? `${id}-error` : undefined}
      >
        <legend className="text-step-0 font-semibold">{seller.legend}</legend>
        {seller.offered.length === 1 && only !== undefined ? (
          <>
            <Text data-testid={`${id}-only`}>{labels.payment.only[only]}</Text>
            <input
              type="hidden"
              name={tenderField(seller.vendorId)}
              value={only}
            />
          </>
        ) : (
          seller.offered.map(tender => (
            <div
              key={tender}
              className="flex min-h-(--target-min) items-start gap-2xs"
            >
              <input
                // Keyed by the submitted choice, so a refused submit keeps it.
                key={state.tenders[seller.vendorId] ?? ''}
                id={`${id}-${tender}`}
                type="radio"
                className="mt-3xs size-s accent-primary"
                name={tenderField(seller.vendorId)}
                value={tender}
                required
                defaultChecked={state.tenders[seller.vendorId] === tender}
                aria-describedby={`${id}-${tender}-hint`}
                data-testid={`${id}-${tender}`}
              />
              <span className="flex flex-col">
                <label htmlFor={`${id}-${tender}`}>
                  {labels.payment.tender[tender]}
                </label>
                <Text tone="muted" id={`${id}-${tender}-hint`}>
                  {labels.payment.hint[tender]}
                </Text>
              </span>
            </div>
          ))
        )}
        {missing ? (
          <p
            className="text-step--1 m-0 text-danger"
            id={`${id}-error`}
            data-testid={`${id}-error`}
          >
            {labels.payment.required}
          </p>
        ) : null}
      </fieldset>
    );
  };

  return (
    // Validated by the browser until React runs, by the server after (#725).
    // Without script the action's state never comes back — Next renders the
    // page after a native post through a resume that takes no form state — so
    // the browser's own check is what keeps what was typed beside its error.
    <form action={action} noValidate={hydrated} data-testid="delivery-form">
      <Stack gap="m">
        {sellers.map(payment)}
        {/* A fieldset defaults to `min-inline-size: min-content`, so the
            municipio select's longest option would widen the page past
            320px; `min-w-0` lets the fields take the width they are given. */}
        <fieldset className="flex min-w-0 flex-col gap-s">
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
        <fieldset className="flex min-w-0 flex-col gap-s">
          <legend className="text-step-1 font-semibold">
            {labels.tax.legend}
          </legend>
          <Text tone="muted">{labels.tax.intro}</Text>
          {field('taxIdType')}
          {field('taxId')}
          {field('taxName')}
        </fieldset>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="reviewed" value={reviewed} />
        {retry ? <input type="hidden" name="retry" value="1" /> : null}
        <SubmitButton data-testid="checkout" className="touch-target">
          {labels.place}
        </SubmitButton>
      </Stack>
    </form>
  );
}
