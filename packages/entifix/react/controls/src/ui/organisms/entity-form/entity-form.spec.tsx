import {
  accessor,
  EntifixConnError,
  EntifixLogicError,
  type Entity,
  entity,
  EntityCollectionLink,
  type EntityId,
  EntityLink,
  type EntityLinkSource,
} from '@r10c/entifix-ts-core';
import { makeFormatters } from '@r10c/entifix-ts-i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntityForm } from './entity-form';
import type {
  EntityFormDraft,
  EntityFormField,
  EntityFormProps,
} from './entity-form.types';
import { EntityField } from './entity-form-slots';
import { resolveEntityFormFields } from './use-entity-form-fields';

@entity({ key: 'gadget-brand' })
class GadgetBrand implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #code?: string;
  #stock = 0;
  #active = false;
  #tier?: string;
  #sku?: string;
  #brand = new EntityLink(GadgetBrand);

  @accessor({ type: 'id', label: 'ID', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Code', required: true })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'number', label: 'Stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'boolean', label: 'Active' })
  get active(): boolean {
    return this.#active;
  }
  set active(value: boolean) {
    this.#active = value;
  }

  @accessor({ type: 'enum', label: 'Tier', enumValues: ['bronze', 'gold'] })
  get tier(): string | undefined {
    return this.#tier;
  }
  set tier(value: string | undefined) {
    this.#tier = value;
  }

  @accessor({ type: 'string', label: 'SKU', readonly: true })
  get sku(): string | undefined {
    return this.#sku;
  }

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<GadgetBrand> {
    return this.#brand;
  }
}

/**
 * Both relation shapes on one entity, so the registry is judged per key rather
 * than per form. Kept apart from `Gadget` because every other test renders that
 * one and a new row would move their assertions.
 */
@entity({ key: 'gadget-bundle' })
class GadgetBundle implements Entity {
  #id?: EntityId;
  #brand = new EntityLink(GadgetBrand);
  #tags = new EntityCollectionLink(GadgetBrand);

  @accessor({ type: 'id', label: 'ID', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<GadgetBrand> {
    return this.#brand;
  }

  @accessor({ type: 'linkCollection', label: 'Tags' })
  get tags(): EntityCollectionLink<GadgetBrand> {
    return this.#tags;
  }
}

function makeGadget(): Gadget {
  const brand = new GadgetBrand();
  brand.id = 'brand-1';
  brand.name = 'Acme';

  const gadget = new Gadget();
  gadget.id = 'gadget-1';
  gadget.code = 'G-1';
  gadget.stock = 1200;
  gadget.active = true;
  gadget.tier = 'gold';
  gadget.brand.setValue(brand);
  return gadget;
}

/** Stateful wrapper so typing round-trips through a controlled draft. */
function Harness({
  initial = {},
  children,
  ...props
}: Partial<EntityFormProps<Gadget>> & {
  initial?: EntityFormDraft;
  children?: ReactNode;
}) {
  const [values, setValues] = useState<EntityFormDraft>(initial);
  return (
    <EntityForm<Gadget>
      entityConstructor={Gadget}
      values={values}
      onFieldChange={(name, value) =>
        setValues(previous => ({ ...previous, [name]: value }))
      }
      {...props}
    >
      {children}
    </EntityForm>
  );
}

describe('resolveEntityFormFields', () => {
  const field = (
    name: string,
    extra: Partial<EntityFormField<Gadget>> = {},
  ): EntityFormField<Gadget> => ({
    name,
    key: name,
    label: name,
    type: 'string',
    sortable: true,
    filterable: true,
    order: 0,
    readonly: false,
    required: false,
    linkLabelProperty: 'name',
    linkSearchProperty: 'name',
    linkSerialization: 'id',
    ...extra,
  });

  it('applies a slot override onto the matching descriptor', () => {
    const [resolved] = resolveEntityFormFields(
      [field('code', { order: 0 })],
      [{ field: 'code', label: 'Product code' }],
    );

    expect(resolved?.label).toBe('Product code');
  });

  it('drops a field a slot marks hidden', () => {
    const resolved = resolveEntityFormFields(
      [field('code'), field('secret', { order: 1 })],
      [{ field: 'secret', hidden: true }],
    );

    expect(resolved.map(entry => entry.name)).toEqual(['code']);
  });

  it('adds a virtual field for a slot naming no member, honouring its order', () => {
    const resolved = resolveEntityFormFields(
      [field('code', { order: 0 })],
      [{ field: 'computed', order: -1 }],
    );

    expect(resolved.map(entry => entry.name)).toEqual(['computed', 'code']);
    expect(resolved[0]).toMatchObject({ virtual: true, label: 'computed' });
  });
});

describe('EntityForm', () => {
  it('builds read-mode fields from metadata, skipping hidden members', () => {
    render(<Harness entity={makeGadget()} />);

    // Declared labels are shown, formatted values too; the hidden id is not.
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByText('G-1')).toBeInTheDocument();
    expect(
      screen.getByText(makeFormatters('es').number(1200)),
    ).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByText('ID')).not.toBeInTheDocument();
  });

  it('renders values as text and no inputs in read mode', () => {
    render(<Harness entity={makeGadget()} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Guardar' }),
    ).not.toBeInTheDocument();
  });

  it('toggles into edit mode and shows inputs', async () => {
    const user = userEvent.setup();
    render(<Harness entity={makeGadget()} initial={{ code: 'G-1' }} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('G-1');
    // The read-only member is present but disabled.
    expect(screen.getByLabelText('SKU')).toBeDisabled();
  });

  it('opens in edit mode with no toggle for a create form', () => {
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Editar' }),
    ).not.toBeInTheDocument();
  });

  it('hides the toggle when the mode is controlled', () => {
    render(<Harness entity={makeGadget()} mode="edit" />);

    expect(
      screen.queryByRole('button', { name: /edit|view/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });

  it('edits a field through the controlled draft', async () => {
    const user = userEvent.setup();
    render(<Harness mode="edit" initial={{ code: '' }} />);

    await user.type(screen.getByLabelText('Code'), 'X');

    expect(screen.getByLabelText('Code')).toHaveValue('X');
  });

  it('submits the current draft', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Harness mode="edit" initial={{ code: 'G-9' }} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onSubmit).toHaveBeenCalledWith({ code: 'G-9' });
  });

  it('renders a boolean without a duplicated label', () => {
    render(<Harness mode="edit" />);

    // The checkbox carries the single "Active" label itself.
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('keeps a relation read-only in edit mode when no source was supplied', () => {
    render(<Harness entity={makeGadget()} mode="edit" />);

    // No text box is emitted for the brand link; its label still shows.
    expect(screen.getByText('Brand')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  describe('with a link source', () => {
    const brandSource = (): EntityLinkSource<GadgetBrand> => {
      const acme = new GadgetBrand();
      acme.id = 'brand-1';
      acme.name = 'Acme';
      return {
        entityConstructor: GadgetBrand,
        labelOf: target => target.name ?? '',
        selected: { label: 'Acme', isLoading: false },
        quick: {
          term: '',
          setTerm: vi.fn(),
          options: [acme],
          isLoading: false,
        },
        browse: {
          items: [acme],
          totalItems: 1,
          currentPage: 1,
          pageSize: 10,
          isLoading: false,
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          onFilteringChange: vi.fn(),
          onSortingChange: vi.fn(),
          isOpen: false,
          open: vi.fn(),
          close: vi.fn(),
        },
      };
    };

    // The registry is the whole mechanism: an entity that declares a `link` gets
    // an editor without the form writing one.
    it('edits the relation through the picker', async () => {
      const onLinkChange = vi.fn();
      const source = brandSource();
      render(
        <Harness
          mode="edit"
          linkSources={{ brand: source }}
          onLinkChange={onLinkChange}
        />,
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'Ver sugerencias de Brand' }),
      );
      await userEvent.click(screen.getByRole('option', { name: 'Acme' }));

      // Both halves land: the id in the draft, the instance alongside it.
      expect(screen.getByTestId('entity-link-value-brand')).toHaveTextContent(
        'Acme',
      );
      expect(onLinkChange).toHaveBeenCalledWith(
        'brand',
        source.quick.options[0],
      );
    });

    it('clears the relation through the picker', async () => {
      const onLinkChange = vi.fn();
      render(
        <Harness
          mode="edit"
          initial={{ brand: 'brand-1' }}
          linkSources={{ brand: brandSource() }}
          onLinkChange={onLinkChange}
        />,
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'Quitar Brand' }),
      );

      expect(onLinkChange).toHaveBeenCalledWith('brand', undefined);
    });

    // A target that was never saved has no key to put in the draft; the draft
    // stays empty rather than carrying `undefined` into the request.
    it('holds no key for a target that has none', async () => {
      const unsaved = new GadgetBrand();
      unsaved.name = 'Unsaved';
      const source = brandSource();
      const onLinkChange = vi.fn();
      render(
        <Harness
          mode="edit"
          linkSources={{
            brand: {
              ...source,
              quick: { ...source.quick, options: [unsaved] },
            },
          }}
          onLinkChange={onLinkChange}
        />,
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'Ver sugerencias de Brand' }),
      );
      await userEvent.click(screen.getByRole('option', { name: 'Unsaved' }));

      expect(onLinkChange).toHaveBeenCalledWith('brand', unsaved);
    });

    it('leaves a relation read-only in read mode', () => {
      render(
        <Harness
          entity={makeGadget()}
          mode="read"
          linkSources={{ brand: brandSource() }}
        />,
      );

      expect(
        screen.queryByRole('button', { name: 'Examinar Brand' }),
      ).not.toBeInTheDocument();
    });

    // A registry that simply has no entry for the collection is not a mistake:
    // the to-one still gets its editor and the to-many keeps its read display.
    it('leaves a to-many member alone when only the to-one has a source', () => {
      render(
        <EntityForm<GadgetBundle>
          entityConstructor={GadgetBundle}
          mode="edit"
          linkSources={{ brand: brandSource() }}
        />,
      );

      expect(screen.getByText('Tags')).toBeInTheDocument();
    });

    // The silent half of the to-many gap: the row fell through the to-one guard
    // into the read display, so the caller got a read-only field and no reason.
    it('refuses a source aimed at a to-many member', () => {
      expect(() =>
        render(
          <EntityForm<GadgetBundle>
            entityConstructor={GadgetBundle}
            mode="edit"
            linkSources={{ tags: brandSource() }}
          />,
        ),
      ).toThrow(EntifixLogicError);
    });

    // A foreign key into another slice's store cannot be a typed `link` — the
    // import would be an illegal edge and the resolution a cross-store join
    // (ADR 0022) — so the member is a plain `string` and the picker has to work
    // over it. Nothing about the editor changes; only the type test in front.
    it('edits a scalar foreign key through the same picker', async () => {
      const onLinkChange = vi.fn();
      const source = brandSource();
      render(
        <Harness
          mode="edit"
          linkSources={{ code: source }}
          onLinkChange={onLinkChange}
        />,
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'Ver sugerencias de Code' }),
      );
      await userEvent.click(screen.getByRole('option', { name: 'Acme' }));

      // The id lands in the draft exactly as it does for a `link`; what the
      // member's type changes is only what happens to it at submit, where
      // `applyEntityLinks` skips a non-`link` and leaves the id standing.
      expect(screen.getByTestId('entity-link-value-code')).toHaveTextContent(
        'Acme',
      );
      expect(onLinkChange).toHaveBeenCalledWith(
        'code',
        source.quick.options[0],
      );
    });

    // A `string` with no source is still an ordinary text box — the picker is
    // opt-in per field, not a new default for every string on the entity.
    it('leaves a string with no source as a plain input', () => {
      render(<Harness mode="edit" linkSources={{ brand: brandSource() }} />);

      expect(screen.getByLabelText('Code')).toHaveValue('');
      expect(
        screen.queryByRole('button', { name: 'Examinar Code' }),
      ).not.toBeInTheDocument();
    });

    // The other half of the widened guard. A number can never name another
    // record, so the entry is dead in every shape the row can render — and a
    // dropped source is indistinguishable from a member declared read-only.
    it('refuses a source aimed at a member that cannot hold a reference', () => {
      expect(() =>
        render(<Harness mode="edit" linkSources={{ stock: brandSource() }} />),
      ).toThrow(EntifixLogicError);
    });
  });

  it('shows per-field validation errors while editing', () => {
    render(<Harness mode="edit" errors={{ code: 'Code is required' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Code is required');
  });

  // A rule spanning two fields belongs to none of the rows, so it renders with
  // the actions it blocks — and only while those actions are on screen.
  it('shows a form-level validation error while editing', () => {
    const { rerender } = render(
      <Harness mode="edit" formError="Dates do not line up" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Dates do not line up');

    rerender(<Harness mode="read" formError="Dates do not line up" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a delete action and a back link when supplied', () => {
    render(
      <Harness
        entity={makeGadget()}
        mode="edit"
        onDelete={vi.fn()}
        backHref="/list"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute(
      'href',
      '/list',
    );
  });

  it('surfaces loading and error states', () => {
    render(<Harness isLoading error={new EntifixConnError('Service down')} />);

    // A skeleton, not the word "Loading": it holds the region's geometry so the
    // swap to real fields shifts nothing, and it needs no translation. The copy
    // survives as the screen-reader announcement, since the shimmer is hidden
    // from assistive tech.
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
    expect(screen.getByTestId('entity-form-error')).toHaveTextContent(
      'Service down',
    );
  });

  // The defect this replaced: the shimmer used to render *beside* the field
  // rows, so a loading form was a placeholder stacked on a full set of empty
  // inputs — twice the height it settles at, and two loading signals at once.
  it('replaces the field rows with the placeholder rather than stacking', () => {
    render(<Harness isLoading />);

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  // The record has not arrived yet, so `entity` is undefined — but that is not
  // the same as there being no record. Titling it "New" for the length of the
  // fetch and then relabelling is a lie the user watches correct itself.
  it('does not call a loading edit form a create', () => {
    render(<Harness isLoading />);

    expect(
      screen.getByRole('heading', { name: 'Detalles' }),
    ).toBeInTheDocument();
  });

  it('lets a caller replace the placeholder', () => {
    render(<Harness isLoading skeleton={<span>Custom placeholder</span>} />);

    expect(screen.getByText('Custom placeholder')).toBeInTheDocument();
    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
  });

  it('renders no placeholder when the caller opts out', () => {
    render(<Harness isLoading skeleton={false} />);

    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
  });

  it('lets a slot replace a field control and its read display', () => {
    render(
      <Harness entity={makeGadget()} mode="edit">
        <EntityField<Gadget>
          field="code"
          render={({ value }) => <output>custom:{value}</output>}
        />
      </Harness>,
    );

    expect(screen.getByText(/custom:/)).toBeInTheDocument();
  });

  it('lets a slot supply a read display', () => {
    render(
      <Harness entity={makeGadget()}>
        <EntityField<Gadget>
          field="brand"
          readRender={ent => <em>{ent?.brand.value?.name} (custom)</em>}
        />
      </Harness>,
    );

    expect(screen.getByText('Acme (custom)')).toBeInTheDocument();
  });

  it('renders a computed virtual field', () => {
    render(
      <Harness entity={makeGadget()}>
        <EntityField<Gadget>
          field="summary"
          label="Summary"
          readRender={ent => <span>{ent?.code} summary</span>}
        />
      </Harness>,
    );

    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('G-1 summary')).toBeInTheDocument();
  });

  it('reports mode changes from the built-in toggle', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<Harness entity={makeGadget()} onModeChange={onModeChange} />);

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(onModeChange).toHaveBeenCalledWith('edit');

    // Toggling back exercises the other direction of the switch.
    await user.click(screen.getByRole('button', { name: 'Ver' }));
    expect(onModeChange).toHaveBeenCalledWith('read');
  });

  it('shows a busy label while saving', () => {
    render(<Harness mode="edit" isSaving onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  });

  it('shows a busy label while deleting', () => {
    render(<Harness mode="edit" isDeleting onDelete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Eliminando…' })).toBeDisabled();
  });

  it('tolerates an uncontrolled render with no draft wiring', async () => {
    const user = userEvent.setup();
    render(<EntityForm entityConstructor={Gadget} mode="edit" />);

    // No `values`/`onFieldChange`: typing must not throw, the field just stays
    // whatever the (empty) draft says.
    await user.type(screen.getByLabelText('Code'), 'Z');

    expect(screen.getByLabelText('Code')).toBeInTheDocument();
  });

  it('renders unmatched children below the fields', () => {
    render(
      <Harness entity={makeGadget()}>
        <footer>extra content</footer>
      </Harness>,
    );

    expect(screen.getByText('extra content')).toBeInTheDocument();
  });
});

/**
 * #119 — the action row is driven by served metadata rather than hardcoded.
 *
 * Note what these do NOT assert: that hiding a button prevents anything. It does
 * not. The route guard is the authorization boundary (ADR 0002); this is about
 * not offering an action the service will refuse.
 */
describe('EntityForm actions from served metadata', () => {
  const useCases = [
    {
      key: 'update-aspects',
      binding: 'entity' as const,
      placement: 'determining' as const,
      labelKey: 'entity:gadget.useCases.updateAspects',
    },
    {
      key: 'revoke-sessions',
      binding: 'entity' as const,
      placement: 'context-independent' as const,
      labelKey: 'entity:gadget.useCases.revokeSessions',
      confirm: {
        tone: 'destructive' as const,
        messageKey: 'entity:gadget.useCases.revokeSessionsConfirm',
      },
    },
  ];

  it('renders Save and Delete unchanged when no metadata is supplied', () => {
    render(<Harness mode="edit" onDelete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();
  });

  it('drops Save when the caller may not write, and Delete when they may not delete', () => {
    render(
      <Harness
        mode="edit"
        onDelete={vi.fn()}
        metadata={{ actions: ['read'], useCases: [] }}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Guardar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Eliminar' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Delete when the caller holds it', () => {
    render(
      <Harness
        mode="edit"
        onDelete={vi.fn()}
        metadata={{ actions: ['read', 'write', 'delete'], useCases: [] }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();
  });

  it('fires a verb with no confirm straight away', async () => {
    const onUseCase = vi.fn();
    render(
      <Harness
        mode="edit"
        metadata={{ actions: ['read', 'write'], useCases: [useCases[0]] }}
        onUseCase={onUseCase}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'gadget.useCases.updateAspects',
      }),
    );

    expect(onUseCase).toHaveBeenCalledWith('update-aspects');
  });

  it('asks before a verb that declares a confirmation, and only then fires', async () => {
    const onUseCase = vi.fn();
    render(
      <Harness
        mode="edit"
        metadata={{ actions: ['read', 'write'], useCases: [useCases[1]] }}
        onUseCase={onUseCase}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'gadget.useCases.revokeSessions',
      }),
    );
    expect(onUseCase).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onUseCase).toHaveBeenCalledWith('revoke-sessions');
  });

  it('fires nothing when the confirmation is dismissed', async () => {
    const onUseCase = vi.fn();
    render(
      <Harness
        mode="edit"
        metadata={{ actions: ['read', 'write'], useCases: [useCases[1]] }}
        onUseCase={onUseCase}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'gadget.useCases.revokeSessions',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onUseCase).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('skips a verb that needs a selection, and one bound to a collection', () => {
    render(
      <Harness
        mode="edit"
        metadata={{
          actions: ['read', 'write'],
          useCases: [
            {
              key: 'compare',
              binding: 'entity',
              // Needs a selection to act on, which a single-record form has not
              // got — that is the bulk bar's job (#121).
              placement: 'context-dependent',
              labelKey: 'entity:gadget.useCases.compare',
            },
            {
              key: 'import',
              binding: 'collection',
              placement: 'determining',
              labelKey: 'entity:gadget.useCases.import',
            },
          ],
        }}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'gadget.useCases.compare' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'gadget.useCases.import' }),
    ).not.toBeInTheDocument();
  });

  it('holds the action row with a skeleton while the document is in flight', () => {
    render(<Harness mode="edit" isMetadataLoading />);

    expect(screen.getByTestId('loading-boundary')).toBeInTheDocument();
  });
});
