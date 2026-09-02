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

export interface EntityActionsSlotProps {
  /** Where the nodes go: beside the title, or beside Save. */
  placement?: 'header' | 'footer';
  children?: ReactNode;
}

/**
 * The genuinely bespoke action, so a page never has to render outside the card.
 *
 * Everything metadata can describe should be a `@useCase()` — that is what
 * makes it permission-filtered, translatable and reachable from the command
 * palette. This slot is for what metadata cannot: an action wired to something
 * only this page knows, a link into another product, a one-off. It renders
 * *after* the declared verbs so the derived actions keep a stable position.
 */
export function EntityActions(_props: EntityActionsSlotProps): ReactNode {
  return null;
}

export interface EntityFormSlots<TEntity extends Entity> {
  fields: Array<EntityFieldSlotProps<TEntity>>;
  /** Bespoke actions, by placement. */
  headerActions: ReactNode[];
  footerActions: ReactNode[];
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
  const slots: EntityFormSlots<TEntity> = {
    fields: [],
    headerActions: [],
    footerActions: [],
    rest: [],
  };

  Children.toArray(children).forEach(child => {
    if (!isValidElement(child)) {
      slots.rest.push(child);
      return;
    }

    if (child.type === EntityField) {
      slots.fields.push(child.props as EntityFieldSlotProps<TEntity>);
    } else if (child.type === EntityActions) {
      const props = child.props as EntityActionsSlotProps;
      const target =
        props.placement === 'header'
          ? slots.headerActions
          : slots.footerActions;
      target.push(props.children);
    } else {
      slots.rest.push(child);
    }
  });

  return slots;
}
