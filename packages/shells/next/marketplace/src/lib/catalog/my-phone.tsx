import { Cluster, SubmitButton, Text } from '@entifix/react-controls/primitives';
import type { DeviceModel } from '@r10c/business-ts-catalog-reference';
import {
  hiddenSearchFields,
  searchHref,
  type SearchState,
} from '@r10c/implementation-marketplace-catalog-next';

import { ForgetMyPhoneLink, RememberMyPhone } from './my-phone-memory';

/** The copy the control renders, already translated. */
export interface MyPhoneLabels {
  readonly label: string;
  readonly choose: string;
  readonly apply: string;
  /** "Para tu {{model}}", interpolated already. */
  readonly showing: string;
  readonly forget: string;
}

export interface MyPhoneProps {
  /** The listing's own address, locale-prefixed. */
  readonly href: string;
  readonly state: SearchState;
  readonly models: readonly DeviceModel[];
  readonly labels: MyPhoneLabels;
}

/**
 * "Mi teléfono": the buyer names their phone once, and the listing shows what
 * fits it — made for that model, or for every phone (plan 1.17, r10c #641).
 *
 * A GET form, like the price range, so it works before any script runs and the
 * filtered listing is an address a buyer can share. The URL is the truth; the
 * browser only **remembers** the last choice, through `RememberMyPhone`, and
 * offers it back on the first listing of a later visit. No cookie: a cookie
 * read would make a prerendered page dynamic (ADR 0051).
 *
 * Renders nothing when the vocabulary holds no models — a store with no phone
 * accessories has nothing to ask.
 */
export function MyPhone({ href, state, models, labels }: MyPhoneProps) {
  if (models.length === 0) return null;
  const chosen = state.model[0];
  const model = models.find(one => String(one.id) === chosen);

  return (
    <section aria-label={labels.label}>
      <RememberMyPhone
        chosen={model === undefined ? undefined : String(model.id)}
        known={models.map(one => String(one.id))}
      />
      {model === undefined ? (
        <form
          method="get"
          action={href}
          className="flex flex-wrap items-end gap-2xs"
        >
          {hiddenSearchFields(state, ['model']).map(([name, value]) => (
            <input
              key={`${name}=${value}`}
              type="hidden"
              name={name}
              value={value}
            />
          ))}
          <label className="text-step--1 flex flex-col gap-3xs text-content-muted">
            {labels.label}
            <select
              name="model"
              defaultValue=""
              className="min-h-11 rounded-md border border-border bg-surface px-2xs text-content"
            >
              <option value="" disabled>
                {labels.choose}
              </option>
              {models.map(one => (
                <option key={String(one.id)} value={String(one.id)}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton variant="secondary">{labels.apply}</SubmitButton>
        </form>
      ) : (
        <Cluster gap="s" align="baseline">
          <Text>{labels.showing}</Text>
          <ForgetMyPhoneLink href={searchHref(href, state, { model: [] })}>
            {labels.forget}
          </ForgetMyPhoneLink>
        </Cluster>
      )}
    </section>
  );
}
