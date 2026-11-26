'use client';

import { loadUCFactory } from '@entifix/business';
import {
  type CrudContext,
  crudContextOf,
  type EntityVerbFormProps,
} from '@entifix/next-shell';
import {
  Button,
  Cluster,
  Stack,
  Text,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { Select, TextInput } from '@entifix/react-controls/primitives';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import {
  KIT_MAX_COMPONENTS,
  PRESENTATION_UNIT,
} from '@r10c/business-ts-sales-vocabulary';
import { useState } from 'react';

import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/** The name `set-kit` declares its form under. */
export const KIT_FORM = 'kit';

/** How many of the vendor's offerings the component picker lists. */
export const KIT_COMPONENT_PAGE = 200;

interface Row {
  readonly key: number;
  readonly offeringId: string;
  readonly quantity: string;
}

/**
 * The offerings a kit may hold: every other one of the vendor's sold by the
 * unit that is not itself a kit (ADR 0086). The service checks it again; this
 * only keeps the picker from offering what it would refuse.
 */
export const componentsFor = (
  record: ProductOffering,
  offerings: readonly ProductOffering[],
): ProductOffering[] =>
  offerings.filter(
    one =>
      one.id !== record.id &&
      one.saleUnit === PRESENTATION_UNIT &&
      (one.kitSize ?? 0) === 0,
  );

/**
 * The components a submit names: the rows that picked an offering, each with
 * the whole number typed. A quantity that is not one is sent as typed, so the
 * service's refusal names it rather than the form quietly dropping it.
 */
export const componentsOf = (rows: readonly Row[]) =>
  rows
    .filter(row => row.offeringId !== '')
    .map(row => ({
      offeringId: row.offeringId,
      quantity: Number(row.quantity),
    }));

/**
 * What `set-kit` asks for (ADR 0086): which of the vendor's offerings one of
 * this holds, and how many of each. No rows makes it a plain offering again.
 * Names the revision the vendor is looking at; a refusal is shown by the
 * dialog that holds the form.
 */
export function KitForm({
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
    initialPageSize: KIT_COMPONENT_PAGE,
    initialSorting: { 0: { property: 'name', type: 'asc' } },
    queryKey: [...entityQueryScope(ProductOffering), 'kit-components'],
  });
  const [rows, setRows] = useState<readonly Row[]>(() =>
    (record.kitComponents ?? []).map((component, key) => ({
      key,
      offeringId: component.offeringId,
      quantity: String(component.quantity),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const update = (key: number, change: Partial<Row>) =>
    setRows(current =>
      current.map(row => (row.key === key ? { ...row, ...change } : row)),
    );

  if (isLoading) {
    return (
      <form id={formId} onSubmit={event => event.preventDefault()}>
        <Text muted>{t('marketplaceAdmin.offering.kit.loading')}</Text>
      </form>
    );
  }

  const choices = componentsFor(record, items);

  return (
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault();
        submit({
          components: componentsOf(rows),
          ...(record.revision === undefined
            ? {}
            : { revision: record.revision }),
        });
      }}
    >
      <Stack gap="s">
        <Text muted>{t('marketplaceAdmin.offering.kit.hint')}</Text>
        {record.saleUnit === PRESENTATION_UNIT ? null : (
          <Text data-testid="kit-not-counted">
            {t('marketplaceAdmin.offering.kit.notCounted')}
          </Text>
        )}
        <ol className="m-0 flex list-none flex-col gap-xs p-0">
          {rows.map((row, at) => {
            const position = at + 1;
            const offeringId = `${formId}-offering-${String(row.key)}`;
            const quantityId = `${formId}-quantity-${String(row.key)}`;
            return (
              <li key={row.key}>
                <Cluster gap="s" align="end">
                  <Stack gap="3xs">
                    <label
                      htmlFor={offeringId}
                      className="text-step--1 font-semibold"
                    >
                      {translateKey('entity:kit-component.fields.offeringId')}
                    </label>
                    <Select
                      id={offeringId}
                      value={row.offeringId}
                      onChange={event =>
                        update(row.key, {
                          offeringId: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="">
                        {t('marketplaceAdmin.offering.kit.pick')}
                      </option>
                      {choices.map(one => (
                        <option key={String(one.id)} value={String(one.id)}>
                          {one.name}
                        </option>
                      ))}
                    </Select>
                  </Stack>
                  <Stack gap="3xs">
                    <label
                      htmlFor={quantityId}
                      className="text-step--1 font-semibold"
                    >
                      {translateKey('entity:kit-component.fields.quantity')}
                    </label>
                    <TextInput
                      id={quantityId}
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={event =>
                        update(row.key, {
                          quantity: event.currentTarget.value,
                        })
                      }
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
                    {t('marketplaceAdmin.offering.kit.remove', { position })}
                  </Button>
                </Cluster>
              </li>
            );
          })}
        </ol>
        {rows.length < KIT_MAX_COMPONENTS ? (
          <Cluster>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRows(current => [
                  ...current,
                  { key: nextKey, offeringId: '', quantity: '1' },
                ]);
                setNextKey(key => key + 1);
              }}
            >
              {t('marketplaceAdmin.offering.kit.add')}
            </Button>
          </Cluster>
        ) : null}
      </Stack>
    </form>
  );
}
