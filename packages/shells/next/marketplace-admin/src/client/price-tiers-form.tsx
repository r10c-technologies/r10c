'use client';

import { getUCFactory } from '@entifix/business';
import { formattingLocale } from '@entifix/core';
import {
  type CrudContext,
  crudContextOf,
  type EntityVerbFormProps,
} from '@entifix/next-shell';
import {
  Button,
  Cluster,
  MoneyInput,
  QuantityInput,
  Stack,
  Text,
  useLocale,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { useEntityRecord } from '@entifix/react-integration';
import type {
  ProductOffering,
  ProductOfferingPrice,
} from '@r10c/business-ts-product-configuration-management';
import {
  MAX_PRICE_TIERS,
  type PriceTier,
  quantityMaximum,
  SALE_UNIT_SYMBOL_KEY,
  saleUnitScale,
} from '@r10c/business-ts-sales-vocabulary';
import { useState } from 'react';

import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/** The name `set-price-tiers` declares its form under. */
export const PRICE_TIERS_FORM = 'price-tiers';

/** One row being edited: a stable key, the quantity, and the amount as typed. */
interface TierDraft {
  readonly key: number;
  readonly from: number;
  /** Minor units as a draft string, `''` while empty: `MoneyInput`'s shape. */
  readonly amount: string;
}

const draftsOf = (tiers: readonly PriceTier[] | undefined): TierDraft[] =>
  (tiers ?? []).map((tier, index) => ({
    key: index,
    from: tier.from,
    amount: String(tier.amount),
  }));

/**
 * What `set-price-tiers` asks for (ADR 0082 §8): where the price steps down
 * by quantity, one row per tier. Each `from` is a quantity in the offering's
 * own unit and scale, and each amount is in the price's currency for its own
 * `pricePer` — both read from the records around the row, which is why this
 * is a form of its own rather than the generic one. The service checks the
 * rows; a refusal is shown by the dialog that holds the form.
 *
 * Submits every row, so removing all of them removes the tiers, and names the
 * revision the vendor is looking at.
 */
export function PriceTiersForm({
  record,
  formId,
  submit,
}: EntityVerbFormProps<ProductOfferingPrice>) {
  const t = useT('r10c');
  const translateKey = useTranslateKey();
  const locale = useLocale();
  const adapters = useMarketplaceAdminAdapters();
  const { entity: offering } = useEntityRecord<ProductOffering, CrudContext>({
    uc: getUCFactory<ProductOffering>(),
    ctx: crudContextOf(adapters, 'productOfferingRest'),
    id: record.offeringId === '' ? undefined : record.offeringId,
  });
  const [rows, setRows] = useState<TierDraft[]>(() => draftsOf(record.tiers));
  const [next, setNext] = useState(rows.length);

  // The quantities mean nothing until the offering says what one is.
  if (offering === undefined) {
    return (
      <form id={formId} onSubmit={event => event.preventDefault()}>
        <Text muted>{t('marketplaceAdmin.price.tiers.loading')}</Text>
      </form>
    );
  }

  const unit = translateKey(`${SALE_UNIT_SYMBOL_KEY}.${offering.saleUnit}`);
  const scale = saleUnitScale(offering.saleUnit);
  const fromLabel = translateKey('entity:price-tier.fields.from');
  const amountLabel = translateKey('entity:price-tier.fields.amount');

  const update = (key: number, change: Partial<TierDraft>) =>
    setRows(current =>
      current.map(row => (row.key === key ? { ...row, ...change } : row)),
    );
  const add = () => {
    const last = rows.at(-1);
    setRows(current => [
      ...current,
      {
        key: next,
        from: (last?.from ?? offering.quantityMinimum) + offering.quantityStep,
        amount: '',
      },
    ]);
    setNext(next + 1);
  };

  return (
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault();
        submit({
          tiers: rows.map(row => ({
            from: row.from,
            amount: Number(row.amount === '' ? Number.NaN : row.amount),
          })),
          ...(record.revision === undefined
            ? {}
            : { revision: record.revision }),
        });
      }}
    >
      <Stack gap="s">
        <Text muted>{t('marketplaceAdmin.price.tiers.hint')}</Text>
        {rows.length === 0 ? (
          <Text data-testid="price-tiers-empty">
            {t('marketplaceAdmin.price.tiers.none')}
          </Text>
        ) : null}
        <ol className="m-0 flex list-none flex-col gap-xs p-0">
          {rows.map((row, index) => {
            const amountId = `${formId}-amount-${String(row.key)}`;
            const position = String(index + 1);
            return (
              <li key={row.key} data-testid="price-tier-row">
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="text-step--1 font-semibold">
                    {t('marketplaceAdmin.price.tiers.row', { position })}
                  </legend>
                  <Cluster gap="xs" align="end">
                    <QuantityInput
                      label={fromLabel}
                      value={row.from}
                      onChange={from => update(row.key, { from })}
                      scale={scale}
                      unit={unit}
                      min={offering.quantityStep}
                      step={offering.quantityStep}
                      max={quantityMaximum(offering)}
                    />
                    <Stack gap="3xs" className="min-w-0">
                      <label
                        htmlFor={amountId}
                        className="text-step--1 font-semibold"
                      >
                        {amountLabel}
                      </label>
                      <MoneyInput
                        id={amountId}
                        value={row.amount}
                        onChange={amount => update(row.key, { amount })}
                        currency={record.currency}
                        unit="minor"
                        locale={formattingLocale(locale)}
                        className="w-32"
                      />
                    </Stack>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRows(current =>
                          current.filter(one => one.key !== row.key),
                        )
                      }
                    >
                      {t('marketplaceAdmin.price.tiers.remove', { position })}
                    </Button>
                  </Cluster>
                </fieldset>
              </li>
            );
          })}
        </ol>
        {rows.length < MAX_PRICE_TIERS ? (
          <Cluster>
            <Button type="button" variant="secondary" size="sm" onClick={add}>
              {t('marketplaceAdmin.price.tiers.add')}
            </Button>
          </Cluster>
        ) : null}
      </Stack>
    </form>
  );
}
