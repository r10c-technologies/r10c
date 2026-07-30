import type { Entity } from '@r10c/entifix-ts-core';

import type { EntityFormField } from './entity-form.types';
import type { EntityFieldSlotProps } from './entity-form-slots';

/**
 * The field pipeline as a pure function — metadata descriptors, then
 * `<EntityField>` overrides, then declared order. Kept separate from the
 * component so the resolution rules can be tested without React.
 *
 * A slot naming a member the entity does not have becomes a virtual field (a
 * computed one); a slot with `hidden` drops its field.
 */
export function resolveEntityFormFields<TEntity extends Entity>(
  described: Array<EntityFormField<TEntity>>,
  slotFields: Array<EntityFieldSlotProps<TEntity>>,
): Array<EntityFormField<TEntity>> {
  const hidden = new Set(
    slotFields.filter(slot => slot.hidden).map(slot => slot.field),
  );

  const merged = described
    .filter(field => !hidden.has(field.name))
    .map(field => {
      const slot = slotFields.find(entry => entry.field === field.name);
      if (!slot) return field;
      const { field: _field, hidden: _hidden, ...overrides } = slot;
      return {
        ...field,
        ...Object.fromEntries(
          Object.entries(overrides).filter(([, value]) => value !== undefined),
        ),
      } as EntityFormField<TEntity>;
    });

  const virtual = slotFields
    .filter(
      slot => !slot.hidden && !described.some(field => field.name === slot.field),
    )
    .map<EntityFormField<TEntity>>((slot, index) => ({
      name: slot.field,
      key: slot.field,
      label: slot.label ?? slot.field,
      type: 'string',
      sortable: false,
      filterable: false,
      order: slot.order ?? described.length + index,
      readonly: false,
      required: false,
      linkLabelProperty: 'name',
      linkSearchProperty: 'name',
      linkSerialization: 'id',
      render: slot.render,
      readRender: slot.readRender,
      virtual: true,
    }));

  return [...merged, ...virtual].sort((left, right) => left.order - right.order);
}
