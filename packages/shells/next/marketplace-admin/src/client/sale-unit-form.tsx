'use client';

import type { EntityVerbFormProps } from '@entifix/next-shell';
import { Stack, Text, useT, useTranslateKey } from '@entifix/react-controls';
import { Select } from '@entifix/react-controls/primitives';
import type { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import {
  SALE_UNIT_NAME_KEY,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';

/** The name `set-sale-unit` declares its form under. */
export const SALE_UNIT_FORM = 'sale-unit';

/**
 * What `set-sale-unit` asks for (ADR 0082 §3): the unit, picked by its name,
 * and the revision the vendor is looking at, so a save or a publish landing
 * in between is refused rather than overwritten. Says what the verb does to
 * step and minimum, because they are reset to one whole unit of the new one.
 */
export function SaleUnitForm({
  record,
  formId,
  submit,
}: EntityVerbFormProps<ProductOffering>) {
  const t = useT('r10c');
  const translateKey = useTranslateKey();
  const selectId = `${formId}-unit`;
  return (
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault();
        // The select offers only the vocabulary, and the verb's schema
        // refuses anything else, so the value is passed as it was chosen.
        submit({
          saleUnit: String(new FormData(event.currentTarget).get('saleUnit')),
          ...(record.revision === undefined
            ? {}
            : { revision: record.revision }),
        });
      }}
    >
      <Stack gap="2xs">
        <label htmlFor={selectId} className="text-step--1 font-semibold">
          {translateKey('entity:product-offering.fields.saleUnit')}
        </label>
        <Select
          id={selectId}
          name="saleUnit"
          className="w-full min-w-0"
          defaultValue={record.saleUnit}
        >
          {SaleUnits.map(unit => (
            <option key={unit} value={unit}>
              {translateKey(`${SALE_UNIT_NAME_KEY}.${unit}`)}
            </option>
          ))}
        </Select>
        <Text muted>{t('marketplaceAdmin.offering.saleUnit.resets')}</Text>
      </Stack>
    </form>
  );
}
