import { contactProblems } from '@r10c/business-ts-order-contracts';

/**
 * The review step's delivery and contact fields, by form name. Kept flat on
 * the form — one native `Select` names the municipio, and its departamento is
 * the code's first two digits — and nested only when the checkout starts
 * ([ADR 0076](../../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §2).
 */
export const CONTACT_FIELDS = [
  'name',
  'phone',
  'email',
  'municipio',
  'zona',
  'addressLine',
  'reference',
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

/** What the buyer typed, field by field, as text. */
export type ContactValues = Readonly<Partial<Record<ContactField, string>>>;

/**
 * Where the review form stands after a refused submit: what the buyer typed,
 * kept so nothing is lost, and the error code each field answered with. Held
 * in action state only — never in a URL or a cookie, because it is personal.
 *
 * The tenders ride beside the contact: what the buyer chose per seller, and
 * the sellers whose choice was missing (ADR 0076 §7).
 */
export interface CheckoutFormState {
  readonly values: ContactValues;
  readonly errors: Readonly<Partial<Record<ContactField, string>>>;
  /** The tender chosen for each seller, by vendor id, as the form sent it. */
  readonly tenders: Readonly<Record<string, string>>;
  /** The sellers the buyer has still to choose a tender for. */
  readonly tendersMissing: readonly string[];
}

export const EMPTY_CHECKOUT_FORM: CheckoutFormState = {
  values: {},
  errors: {},
  tenders: {},
  tendersMissing: [],
};

/** The prefix a field's name carries on the form, so it cannot collide. */
const PREFIX = 'contact.';

export const contactFieldName = (field: ContactField) => `${PREFIX}${field}`;

/** The buyer's typed values, read off a submitted form. */
export const contactValuesOf = (formData: FormData): ContactValues =>
  Object.fromEntries(
    CONTACT_FIELDS.flatMap(field => {
      const value = formData.get(contactFieldName(field));
      return typeof value === 'string' ? [[field, value]] : [];
    }),
  );

/** `true` when the form carried no contact field at all — a bare retry. */
export const namesNoContact = (values: ContactValues) =>
  CONTACT_FIELDS.every(field => values[field] === undefined);

/**
 * The contact as the checkout states it, nested, from the form's flat text:
 * the departamento comes from the municipio's code, and an empty optional
 * field is left out rather than sent empty.
 */
export const contactOf = (values: ContactValues): unknown => {
  const municipio = values.municipio ?? '';
  const zona = values.zona?.trim() ?? '';
  const reference = values.reference?.trim() ?? '';
  return {
    name: values.name ?? '',
    phone: values.phone ?? '',
    email: values.email ?? '',
    destination: {
      departamento: municipio.slice(0, 2),
      municipio,
      ...(zona === '' ? {} : { zona: Number(zona) }),
      addressLine: values.addressLine ?? '',
      ...(reference === '' ? {} : { reference }),
    },
  };
};

/**
 * The form field a problem's pointer names. The departamento is not a field of
 * its own — the municipio's choice decides it — so its problem lands on the
 * municipio.
 */
const fieldOf = (pointer: string): ContactField => {
  const leaf = pointer.split('/').at(-1) as string;
  return leaf === 'departamento' ? 'municipio' : (leaf as ContactField);
};

/**
 * Each field's first error code, or nothing when the contact is complete —
 * the same rules order-service applies, so a buyer never meets a refusal the
 * form did not already give.
 */
export const contactErrors = (
  values: ContactValues,
): CheckoutFormState['errors'] => {
  const errors: Partial<Record<ContactField, string>> = {};
  for (const problem of contactProblems(contactOf(values))) {
    const field = fieldOf(problem.pointer);
    errors[field] ??= problem.code;
  }
  return errors;
};

/** The query member a refused post without script returns its codes on. */
export const REFUSED_PARAM = 'refused';

/**
 * A refused form's errors as one query value — `phone.phoneNotGuatemalan`,
 * `tender.<vendorId>` — for a post made without script, whose action state
 * Next never brings back (#725). Codes and seller ids only: what the buyer
 * typed is personal and stays out of the address (ADR 0076 §2).
 */
export const refusalQuery = (state: CheckoutFormState): string =>
  [
    ...Object.entries(state.errors).map(([field, code]) => `${field}.${code}`),
    ...state.tendersMissing.map(vendorId => `tender.${vendorId}`),
  ].join(',');

/**
 * The form state a `refusalQuery` names, keeping only fields the form has,
 * codes the contact can answer and sellers on this review; anything else in
 * the address is ignored rather than shown.
 */
export const refusedState = (
  raw: unknown,
  codes: readonly string[],
  vendorIds: readonly string[],
): CheckoutFormState => {
  if (typeof raw !== 'string' || raw === '') return EMPTY_CHECKOUT_FORM;
  const errors: Partial<Record<ContactField, string>> = {};
  const tendersMissing: string[] = [];
  for (const entry of raw.split(',')) {
    const dot = entry.indexOf('.');
    const [key, value] = [entry.slice(0, dot), entry.slice(dot + 1)];
    if (key === 'tender') {
      if (vendorIds.includes(value)) tendersMissing.push(value);
    } else if (
      (CONTACT_FIELDS as readonly string[]).includes(key) &&
      codes.includes(value)
    ) {
      errors[key as ContactField] ??= value;
    }
  }
  return { ...EMPTY_CHECKOUT_FORM, errors, tendersMissing };
};
