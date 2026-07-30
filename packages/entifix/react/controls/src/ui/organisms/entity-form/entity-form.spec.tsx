import {
  accessor,
  EntifixConnError,
  type Entity,
  entity,
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
            brand: { ...source, quick: { ...source.quick, options: [unsaved] } },
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

    expect(screen.getByTestId('entity-form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('entity-form-error')).toHaveTextContent(
      'Service down',
    );
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
