'use client';

import {
  type SalesChannelType,
  SalesChannelTypes,
} from '@r10c/business-ts-sales-vocabulary';
import type { ChannelCommissionRates } from '@r10c/business-ts-settlement-management';
import { TextInput, useT } from '@r10c/entifix-react-controls';

export interface ChannelRateEditorProps {
  /** The rates as the record carries them: absent keys take the default. */
  value: ChannelCommissionRates;
  onChange: (next: ChannelCommissionRates) => void;
  /** The label's `for` target, so the first input is what it points at. */
  id: string;
  disabled?: boolean;
}

/**
 * One numeric input per sales channel type, each independently clearable.
 *
 * ⚠️ **Absent and `0` are different values, and keeping them visibly different
 * is the entire point of this control.** An empty input means "charge the
 * agreement's default rate for this channel"; a typed `0` means "take nothing
 * here", which is the term ADR 0024 put a per-channel map on the agreement for.
 * A control that coerced one into the other would make the feature
 * unexpressible through the only surface that authors it — and the coercion
 * `rates[type] || fallback` makes silently, one layer down, is the same bug.
 *
 * ⚠️ **This exists because a map has no editor and cannot have one.** The entity
 * framework's ten member types are scalars, two relation shapes and two
 * collections; a draft value is a string or a list of row drafts. So
 * `channelCommissionBasisPoints` is declared `type: 'number'` over an object,
 * and a generated form renders it as a number input reading `[object Object]`,
 * fails validation, and writes `NaN` over the map on save. The field is hidden
 * from the generated form and this control is rendered in its place.
 *
 * ⚠️ **It holds its own state rather than the form's draft**, for the reason
 * above: the draft cannot carry an object, and encoding one as a string would
 * put a second representation of the map in the system. The cost is stated
 * rather than hidden — an edit here does not mark the form dirty, and a
 * workspace tab does not autosave it. `ConfigurationForm` accepts the same
 * limit for the same reason.
 *
 * The type list is the real `SalesChannelType`, from the `business:policy`
 * vocabulary both this domain and `sales-management` depend on. A channel type
 * added there appears here with no edit, which is what stops a vendor selling
 * through a channel nobody can price.
 */
export function ChannelRateEditor({
  value,
  onChange,
  id,
  disabled = false,
}: ChannelRateEditorProps) {
  const et = useT('entity');
  const st = useT('shell');

  const setRate = (channelType: SalesChannelType, raw: string) => {
    const next: Record<string, number> = {};
    for (const type of SalesChannelTypes) {
      const current = type === channelType ? raw : rawValue(value, type);
      if (current !== '') {
        next[type] = Number(current);
      }
    }
    onChange(next as ChannelCommissionRates);
  };

  return (
    <div>
      <p>{st('settlement.agreement.channelRatesHint')}</p>
      {SalesChannelTypes.map((channelType, index) => (
        <label key={channelType}>
          {et(`sales-channel.values.type.${channelType}`)}
          <TextInput
            id={index === 0 ? id : `${id}-${channelType}`}
            type="number"
            inputMode="numeric"
            disabled={disabled}
            // An empty string, never `0`. A `value` of `0` and a value of `''`
            // render identically to a reader who is not looking for it, and
            // they mean opposite things here.
            value={rawValue(value, channelType)}
            placeholder={st('settlement.agreement.channelRateDefault')}
            onChange={event => setRate(channelType, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

/** The stored rate as an input value: `''` when the channel has no entry. */
const rawValue = (
  rates: ChannelCommissionRates,
  channelType: SalesChannelType,
): string => {
  const rate = rates[channelType];
  return rate === undefined ? '' : String(rate);
};
