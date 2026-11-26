'use client';

import type { EntityVerbFormProps } from '@entifix/next-shell';
import {
  Button,
  Cluster,
  Stack,
  Text,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { Select, TextInput } from '@entifix/react-controls/primitives';
import type { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import {
  MAX_VARIANT_AXES,
  MAX_VARIANT_VALUE_LENGTH,
  VARIANT_AXES,
  type VariantAxis,
  type VariantValue,
} from '@r10c/business-ts-sales-vocabulary';
import { useState } from 'react';

/** The name `set-variant` declares its form under. */
export const VARIANT_FORM = 'variant';

interface Row {
  readonly key: number;
  readonly axis: VariantAxis;
  readonly value: string;
}

/** The first axis no row has taken yet, for a row being added. */
export const nextAxis = (rows: readonly { axis: VariantAxis }[]): VariantAxis =>
  VARIANT_AXES.find(axis => !rows.some(row => row.axis === axis)) ??
  VARIANT_AXES[0];

/**
 * What a form sends: the rows with a value, as the verb takes them. A blank
 * row is a row the vendor did not finish, not a value; none at all makes the
 * offering a product of its own again.
 */
export const variantPayloadOf = (
  rows: readonly { axis: VariantAxis; value: string }[],
): VariantValue[] =>
  rows
    .filter(row => row.value.trim() !== '')
    .map(({ axis, value }) => ({ axis, value: value.trim() }));

/**
 * What `set-variant` asks for (ADR 0085): up to three attributes of the
 * product — colour, size, finish, capacity — and this offering's value on
 * each. Every variant of the product uses the same attributes and none
 * repeats another's combination; the service says which rule a choice broke,
 * and the dialog that holds the form shows it. Names the revision the vendor
 * is looking at.
 */
export function VariantForm({
  record,
  formId,
  submit,
}: EntityVerbFormProps<ProductOffering>) {
  const t = useT('r10c');
  const translateKey = useTranslateKey();
  const [rows, setRows] = useState<readonly Row[]>(() =>
    (record.variantValues ?? []).map(({ axis, value }, key) => ({
      key,
      axis,
      value,
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const update = (key: number, change: Partial<Row>) =>
    setRows(current =>
      current.map(row => (row.key === key ? { ...row, ...change } : row)),
    );

  return (
    <form
      id={formId}
      onSubmit={event => {
        event.preventDefault();
        submit({
          variantValues: variantPayloadOf(rows),
          ...(record.revision === undefined
            ? {}
            : { revision: record.revision }),
        });
      }}
    >
      <Stack gap="s">
        <Text muted>{t('marketplaceAdmin.offering.variant.hint')}</Text>
        {rows.length === 0 ? (
          <Text data-testid="variant-none">
            {t('marketplaceAdmin.offering.variant.none')}
          </Text>
        ) : null}
        <ol className="m-0 flex list-none flex-col gap-2xs p-0">
          {rows.map((row, index) => {
            const position = String(index + 1);
            const axisId = `${formId}-axis-${String(row.key)}`;
            const valueId = `${formId}-value-${String(row.key)}`;
            return (
              <li key={row.key}>
                <Cluster gap="s" align="end">
                  <Stack gap="3xs">
                    <label
                      htmlFor={axisId}
                      className="text-step--1 font-semibold"
                    >
                      {translateKey('entity:variant-value.fields.axis')}
                    </label>
                    <Select
                      id={axisId}
                      value={row.axis}
                      onChange={event =>
                        update(row.key, {
                          axis: event.currentTarget.value as VariantAxis,
                        })
                      }
                    >
                      {VARIANT_AXES.map(axis => (
                        <option key={axis} value={axis}>
                          {translateKey(
                            `entity:variant-value.values.axis.${axis}`,
                          )}
                        </option>
                      ))}
                    </Select>
                  </Stack>
                  <Stack gap="3xs">
                    <label
                      htmlFor={valueId}
                      className="text-step--1 font-semibold"
                    >
                      {translateKey('entity:variant-value.fields.value')}
                    </label>
                    <TextInput
                      id={valueId}
                      value={row.value}
                      maxLength={MAX_VARIANT_VALUE_LENGTH}
                      onChange={event =>
                        update(row.key, { value: event.currentTarget.value })
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
                    {t('marketplaceAdmin.offering.variant.remove', {
                      position,
                    })}
                  </Button>
                </Cluster>
              </li>
            );
          })}
        </ol>
        {rows.length < MAX_VARIANT_AXES ? (
          <Cluster>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRows(current => [
                  ...current,
                  { key: nextKey, axis: nextAxis(current), value: '' },
                ]);
                setNextKey(key => key + 1);
              }}
            >
              {t('marketplaceAdmin.offering.variant.add')}
            </Button>
          </Cluster>
        ) : null}
      </Stack>
    </form>
  );
}
