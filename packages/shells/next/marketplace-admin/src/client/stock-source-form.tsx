'use client';

import { loadUCFactory } from '@entifix/business';
import {
  type CrudContext,
  crudContextOf,
  type EntityVerbFormProps,
} from '@entifix/next-shell';
import {
  QuantityInput,
  Stack,
  Text,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { Select } from '@entifix/react-controls/primitives';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import {
  PRESENTATION_UNIT,
  SALE_UNIT_SYMBOL_KEY,
  saleUnitScale,
} from '@r10c/business-ts-sales-vocabulary';
import { useState } from 'react';

import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/** The name `draw-on-stock` declares its form under. */
export const STOCK_SOURCE_FORM = 'stock-source';

/** How many of the vendor's offerings the base picker lists. */
export const STOCK_BASE_PAGE = 200;

/**
 * The offerings this one may draw on: every other one of the vendor's that is
 * not itself a presentation (ADR 0082 §7). The service checks it again; this
 * only keeps the picker from offering what it would refuse.
 */
export const basesFor = (
  record: ProductOffering,
  offerings: readonly ProductOffering[],
): ProductOffering[] =>
  offerings.filter(
    one => one.id !== record.id && one.stockOfferingId === undefined,
  );

/**
 * What `draw-on-stock` asks for (ADR 0082 §7): the base offering whose stock a
 * box, a roll or a dozen is sold from, and how much of it one takes — typed in
 * the base's own unit, so a 100 m roll reads `100 m` and is sent as `100000`.
 * Choosing no base stops the offering drawing on one. Names the revision the
 * vendor is looking at; a refusal is shown by the dialog that holds the form.
 */
export function StockSourceForm({
  record,
  formId,
  submit,
}: EntityVerbFormProps<ProductOffering>) {
  const t = useT('r10c');
  const translateKey = useTranslateKey();
  const adapters = useMarketplaceAdminAdapters();
  const { isLoading, items } = useDataLoading<ProductOffering, CrudContext>({
    uc: loadUCFactory<ProductOffering>(),
    ctx: crudContextOf(adapters, 'productOfferingRest'),
    initialPageSize: STOCK_BASE_PAGE,
    initialSorting: { 0: { property: 'name', type: 'asc' } },
    queryKey: [...entityQueryScope(ProductOffering), 'stock-bases'],
  });
  const [baseId, setBaseId] = useState(record.stockOfferingId ?? '');
  const [factor, setFactor] = useState(record.stockFactor ?? 0);
  const selectId = `${formId}-base`;

  if (isLoading) {
    return (
      <form id={formId} onSubmit={event => event.preventDefault()}>
        <Text muted>{t('marketplaceAdmin.offering.stockSource.loading')}</Text>
      </form>
    );
  }

  const bases = basesFor(record, items);
  const base = bases.find(one => String(one.id) === baseId);

  return (
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault();
        submit({
          ...(baseId === ''
            ? {}
            : { stockOfferingId: baseId, stockFactor: factor }),
          ...(record.revision === undefined
            ? {}
            : { revision: record.revision }),
        });
      }}
    >
      <Stack gap="s">
        <Text muted>{t('marketplaceAdmin.offering.stockSource.hint')}</Text>
        {record.saleUnit === PRESENTATION_UNIT ? null : (
          <Text data-testid="stock-source-not-counted">
            {t('marketplaceAdmin.offering.stockSource.notCounted')}
          </Text>
        )}
        <Stack gap="2xs">
          <label htmlFor={selectId} className="text-step--1 font-semibold">
            {translateKey('entity:product-offering.fields.stockOfferingId')}
          </label>
          <Select
            id={selectId}
            name="stockOfferingId"
            className="w-full min-w-0"
            value={baseId}
            onChange={event => setBaseId(event.currentTarget.value)}
          >
            <option value="">
              {t('marketplaceAdmin.offering.stockSource.none')}
            </option>
            {bases.map(one => (
              <option key={String(one.id)} value={String(one.id)}>
                {one.name}
              </option>
            ))}
          </Select>
        </Stack>
        {base === undefined ? null : (
          <QuantityInput
            label={t('marketplaceAdmin.offering.stockSource.factor')}
            value={factor}
            onChange={setFactor}
            scale={saleUnitScale(base.saleUnit)}
            unit={translateKey(`${SALE_UNIT_SYMBOL_KEY}.${base.saleUnit}`)}
            min={1}
            step={base.quantityStep}
          />
        )}
      </Stack>
    </form>
  );
}
