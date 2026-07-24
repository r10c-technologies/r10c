import type { Entity } from '@r10c/entifix-ts-core';
import { Children, isValidElement, type ReactNode } from 'react';

import type { EntityFieldRenderContext } from './entity-form.types';

/**
 * The declarative customization API, mirroring `entity-table`'s slots: an
 * `<EntityField>` is configuration expressed as JSX. It never renders itself —
 * `EntityForm` reads its props and decides where the override applies — so a
 * simple form stays a single self-closing tag while a complex one overrides one
 * field's control (e.g. an entity-link picker) without an options object.
 */
export interface EntityFieldSlotProps<TEntity extends Entity = Entity> {
  /** Accessor name. An unknown name adds a computed, entity-less field. */
  field: string;
  label?: string;
  order?: number;
  /** Drop this field from the form entirely. */
  hidden?: boolean;
  /** Custom edit control. */
  render?: (context: EntityFieldRenderContext) => ReactNode;
  /** Custom read display. */
  readRender?: (entity: TEntity | undefined) => ReactNode;
}

/** Overrides one metadata-derived field, or adds a computed one. */
export function EntityField<TEntity extends Entity = Entity>(
  _props: EntityFieldSlotProps<TEntity>,
): ReactNode {
  return null;
}

export interface EntityFormSlots<TEntity extends Entity> {
  fields: Array<EntityFieldSlotProps<TEntity>>;
  /** Children that matched no slot — rendered below the fields untouched. */
  rest: ReactNode[];
}

/**
 * Sorts children into slots by component identity (survives minification and
 * cannot collide with an unrelated component of the same name).
 */
export function readEntityFormFields<TEntity extends Entity>(
  children: ReactNode,
): EntityFormSlots<TEntity> {
  const slots: EntityFormSlots<TEntity> = { fields: [], rest: [] };

  Children.toArray(children).forEach(child => {
    if (!isValidElement(child)) {
      slots.rest.push(child);
      return;
    }

    if (child.type === EntityField) {
      slots.fields.push(child.props as EntityFieldSlotProps<TEntity>);
    } else {
      slots.rest.push(child);
    }
  });

  return slots;
}
