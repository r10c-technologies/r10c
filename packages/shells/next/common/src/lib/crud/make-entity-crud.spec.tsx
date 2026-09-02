import { EntityColumn } from '@r10c/entifix-react-controls';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  accessor,
  EntifixBuildError,
  EntifixConnError,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEntityCrud } from './make-entity-crud';

// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
const push = vi.fn();
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
}));

/**
 * Entities declared here rather than imported from a domain package: the factory
 * is `scope:shared` and must not learn any domain, and a local class is the only
 * way to exercise the shapes that matter — a member the create transaction
 * assigns, and a scalar foreign key with no typed link behind it.
 *
 * They borrow the real catalog keys so `useT('entity')` resolves real copy and
 * the assertions can stay in Spanish, the default locale, like every other suite.
 */
@entity({
  domain: 'testing',
  key: 'product-brand',
  labelKey: 'entity:product-brand.label',
  pluralKey: 'entity:product-brand.plural',
})
class Brand implements Entity {
  #id?: EntityId;
  #code?: string;
  #name: string;
  #website?: string;

  constructor(name = '') {
    this.#name = name;
  }

  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-brand.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product-brand.fields.code',
  })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-brand.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    label: 'Website',
    labelKey: 'entity:product-brand.fields.website',
  })
  get website(): string | undefined {
    return this.#website;
  }
  set website(value: string | undefined) {
    this.#website = value;
  }
}

@entity({
  domain: 'testing',
  key: 'product-specification',
  labelKey: 'entity:product-specification.label',
  pluralKey: 'entity:product-specification.plural',
})
class Product implements Entity {
  #id?: EntityId;
  #name: string;
  #brandId?: string;

  constructor(name = '') {
    this.#name = name;
  }

  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-specification.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-specification.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  // A bare id, not a `link`: its target is another slice's store.
  @accessor({
    type: 'string',
    label: 'Brand',
    // The catalog key is `brand`, not `brandId`: the field holds an id but the
    // label names the thing.
    labelKey: 'entity:product-specification.fields.brand',
  })
  get brandId(): string | undefined {
    return this.#brandId;
  }
  set brandId(value: string | undefined) {
    this.#brandId = value;
  }
}

interface TestAdapters {
  brandRest: Context.Context<EntityRepositoryTag>;
  productRest: Context.Context<EntityRepositoryTag>;
  configurationStore: Context.Context<ConfigurationRepositoryTag>;
}

let repositories: {
  brand: ReturnType<typeof makeInMemoryEntityRepository>;
  product: ReturnType<typeof makeInMemoryEntityRepository>;
};

const useAdapters = (): TestAdapters => ({
  brandRest: Context.make(EntityRepositoryTag, repositories.brand),
  productRest: Context.make(EntityRepositoryTag, repositories.product),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const brandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/product-brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  configuration: 'configurationStore',
  hiddenFields: ['id', 'code'],
  columns: (
    <EntityColumn<Brand>
      field="website"
      render={brand => <span>{brand.website ?? '—'}</span>}
    />
  ),
});

// No `labelProperty`/`searchProperty`, so the picker falls back to `'name'`.
const productCrud = makeEntityCrud<Product, TestAdapters>(Product, {
  useAdapters,
  basePath: '/catalog/product',
  catalogKey: 'product-specification',
  repository: 'productRest',
  configuration: 'configurationStore',
  hiddenFields: ['id'],
  links: [
    { field: 'brandId', entityConstructor: Brand, repository: 'brandRest' },
  ],
});

/**
 * The same entity again, opted into the affordances half: a metadata source and
 * a bulk runner. Separate from `brandCrud` on purpose — the un-opted factory
 * has to keep rendering exactly as it did before either option existed, and one
 * shared instance could not show both.
 */
const runBulk = vi.fn();
const fetchMetadata = vi.fn();

const bulkBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  configuration: 'configurationStore',
  hiddenFields: ['id', 'code'],
  metadataSource: { fetchMetadata: () => fetchMetadata() },
  runBulkUseCase: (key, selection) => runBulk(key, selection),
});

const makeBrand = (id: string, name: string, code?: string) => {
  const brand = new Brand(name);
  brand.id = id;
  brand.code = code;
  return brand;
};

const renderPage = (page: ReactElement) =>
  render(<EntifixQueryProvider>{page}</EntifixQueryProvider>);

beforeEach(() => {
  push.mockClear();
  slug = 'new';
  repositories = {
    brand: makeInMemoryEntityRepository([
      makeBrand('b-1', 'Acme', 'brand-001'),
    ] as Entity[]),
    product: makeInMemoryEntityRepository([] as Entity[]),
  };
});

describe('makeEntityCrud, at factory time', () => {
  // The catalog key and `@entity({ key })` are the same string by convention, so
  // a drifted one is invisible: the form renders, titled after another entity.
  it('rejects a catalog key that is not the entity’s own', () => {
    expect(() =>
      makeEntityCrud<Brand, TestAdapters>(Brand, {
        useAdapters,
        basePath: '/catalog/product-brand',
        catalogKey: 'product-category',
        repository: 'brandRest',
        configuration: 'configurationStore',
      }),
    ).toThrow(EntifixBuildError);
  });

  // A picker aimed at a member that does not exist renders identically to a
  // read-only field — the same silent failure `assertLinkSourcesAreEditable`
  // exists to catch one layer down.
  it('rejects a link naming a member the entity does not declare', () => {
    expect(() =>
      makeEntityCrud<Product, TestAdapters>(Product, {
        useAdapters,
        basePath: '/catalog/product',
        catalogKey: 'product-specification',
        repository: 'productRest',
        configuration: 'configurationStore',
        links: [
          {
            field: 'vendorId',
            entityConstructor: Brand,
            repository: 'brandRest',
          },
        ],
      }),
    ).toThrow(/no member "vendorId"/);
  });

  it('carries the entity’s identity for a registry to derive from', () => {
    expect(brandCrud.entityKey).toBe('product-brand');
    expect(brandCrud.basePath).toBe('/catalog/product-brand');
    expect(brandCrud.entityConstructor).toBe(Brand);
  });
});

describe('the generated list page', () => {
  it('lists records from the adapters it was given', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
  });

  // The `<EntityColumn>` slot is still the escape hatch for presentation the
  // metadata cannot express, so the factory has to forward it untouched.
  it('forwards the column overrides it was handed', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('—').length).toBeGreaterThan(0),
    );
  });
});

/**
 * The adopt half: a generated catalog only gains the ADR 0026/0035 surfaces
 * when it is handed the two options. Before they existed every generated page
 * ran the pre-0026 behaviour, and omitting them still does.
 */
describe('the generated list page, opted into affordances', () => {
  const RETIRE = {
    key: 'retire',
    binding: 'collection' as const,
    placement: 'context-dependent' as const,
    labelKey: 'entity:product-brand.useCases.retire',
  };

  beforeEach(() => {
    runBulk.mockReset().mockResolvedValue([{ id: 'b-1', ok: true }]);
    fetchMetadata
      .mockReset()
      .mockResolvedValue({ actions: ['read', 'write'], useCases: [RETIRE] });
  });

  it('renders no selection column without a bulk runner', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByRole('table')).queryAllByRole('checkbox'),
    ).toHaveLength(0);
  });

  it('renders the selection column once a runner is supplied', async () => {
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getAllByRole('checkbox').length,
      ).toBeGreaterThan(0),
    );
  });

  /**
   * Measured live against an `admin`, who holds `catalog-reference:*:read` and
   * no `retire`: the service filters the verb out of the document, but the
   * selection column still rendered — offering a set no action could be taken
   * on. A checkbox that leads nowhere reads as a permission the user does not
   * have, which is worse than no checkbox.
   */
  it('renders no selection column when the caller may run no collection verb', async () => {
    fetchMetadata.mockResolvedValue({ actions: ['read'], useCases: [] });
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByRole('table')).queryAllByRole('checkbox'),
    ).toHaveLength(0);
  });

  /**
   * The whole adopt step in one assertion: a served verb reaches a generated
   * page, runs over the ticked rows, and the listing re-reads what it changed.
   */
  it('runs a served collection verb over the selection and re-reads the rows', async () => {
    const user = userEvent.setup();
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );

    // Named after the first column that is not the identifier — here the
    // brand's `code`, which is what an operator reads the row as. `hiddenFields`
    // hides members from the *form*, not from the listing.
    await user.click(
      within(screen.getByRole('table')).getByRole('checkbox', {
        name: 'Seleccionar brand-001',
      }),
    );
    // The served document arrives asynchronously — which is the accepted cost
    // ADR 0026 recorded: rendering an action is a fetch where rendering a field
    // is not. So the verb appears a tick after the selection does.
    // "Retirar", not the key: this verb's copy is in the real catalog, so the
    // runtime `labelKey` resolves — which is the half `@r10c/i18n-check` exists
    // to keep true, since the type system cannot see a `translateKey` argument.
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    await waitFor(() => expect(runBulk).toHaveBeenCalled());
    expect(runBulk.mock.calls[0]?.[0]).toBe('retire');
    // And the result is reported per row rather than as one notice.
    await waitFor(() =>
      expect(screen.getByTestId('bulk-result')).toBeInTheDocument(),
    );
  });
});

describe('the generated form', () => {
  it('titles a create and an edit differently', async () => {
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByText('Nueva marca')).toBeVisible());

    slug = 'b-1';
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByText('Editar marca')).toBeVisible());
  });

  // `entity` is undefined until the record lands, so testing it alone titled a
  // loading edit form "New" and then relabelled it (#139).
  it('does not title a loading edit form as a create', async () => {
    slug = 'b-1';
    repositories.brand.failNext(new EntifixConnError('unreachable'));

    renderPage(<brandCrud.SingleViewPage />);

    expect(screen.queryByText(/^Nueva/)).toBeNull();
  });

  it('hides every member it was told to hide, and shows the rest', async () => {
    slug = 'b-1';

    renderPage(<brandCrud.SingleViewPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    expect(screen.queryByLabelText(/código/i)).toBeNull();
  });

  // A hidden member is dropped from the rendered fields, not from the draft:
  // `code` is assigned by the create transaction and must survive an update
  // that never showed it.
  it('carries a hidden member back out of the draft on save', async () => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), 'Globex');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const saved = repositories.brand.items[0] as Brand;
    expect(saved.name).toBe('Globex');
    expect(saved.code).toBe('brand-001');
    expect(saved.id).toBe('b-1');
  });

  // The inverse of `seedFieldValue`: a field the user never touched submits as
  // absent, not as an empty string that would persist as a real value.
  it('submits an untouched optional as undefined, not an empty string', async () => {
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toBeVisible());

    await user.type(screen.getByLabelText(/nombre/i), 'Initech');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const saved = repositories.brand.items.at(-1) as Brand;
    expect(saved.name).toBe('Initech');
    expect(saved.website).toBeUndefined();
  });

  it('offers no delete on the create slug', async () => {
    renderPage(<brandCrud.SingleViewPage />);

    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toBeVisible());
    expect(
      screen.queryByRole('button', { name: 'Eliminar' }),
    ).not.toBeInTheDocument();
  });

  // Both write paths fall back to the list route when no host claims them.
  it.each([
    ['a save', 'Guardar'],
    ['a delete', 'Eliminar'],
  ])('returns to the listing after %s', async (_label, button) => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: button }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // Locale-prefixed: an unprefixed href still resolves, but the middleware
    // bounces it, so the visitor pays a round trip per navigation.
    expect(push).toHaveBeenCalledWith('/es/catalog/product-brand');
  });

  it.each([
    ['saving', 'Guardar'],
    ['deleting', 'Eliminar'],
  ])('stays on the form when %s fails', async (_label, button) => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    repositories.brand.failNext(new EntifixConnError('unreachable'));

    await user.click(screen.getByRole('button', { name: button }));

    await waitFor(() =>
      expect(screen.getByTestId(/form-error$/)).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  // The workspace tab host overrides both, so a save inside a tab stays in the
  // workspace instead of navigating the whole app to the list route.
  it('calls the host’s callbacks instead of navigating, when given them', async () => {
    slug = 'b-1';
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderPage(
      <brandCrud.SingleViewPage
        slug="b-1"
        onSaved={onSaved}
        onDeleted={onDeleted}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('seeds from a persisted draft and reports every edit', async () => {
    const onDraftChange = vi.fn();
    const user = userEvent.setup();

    renderPage(
      <brandCrud.SingleViewPage
        initialDraft={{ name: 'Hooli' }}
        onDraftChange={onDraftChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Hooli'),
    );
    await user.type(screen.getByLabelText(/nombre/i), '!');
    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
  });
});

describe('the generated form’s pickers', () => {
  const held = () => screen.getByTestId('entity-link-value-brandId');

  // No `labelProperty`/`searchProperty` on the link above, so both fall back to
  // `'name'` — the default a scalar id's accessor cannot state for itself.
  it('resolves a held id to its target’s name through the default property', async () => {
    const product = new Product('Widget');
    product.id = 'p-1';
    product.brandId = 'b-1';
    repositories.product = makeInMemoryEntityRepository([product] as Entity[]);
    slug = 'p-1';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() => expect(held()).toHaveTextContent('Acme'));
  });

  // Nothing enforces the reference across a store boundary, so a deleted target
  // leaves an id pointing at nothing. That is a display gap, never a corrupt
  // record, and the field has to keep showing the key.
  it('falls back to the bare id when the target no longer exists', async () => {
    const orphan = new Product('Gizmo');
    orphan.id = 'p-2';
    orphan.brandId = 'b-404';
    repositories.product = makeInMemoryEntityRepository([orphan] as Entity[]);
    slug = 'p-2';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() => expect(held()).toHaveTextContent('b-404'));
  });

  // An empty draft entry is "unset", not an id: nothing enforces the reference,
  // so `''` would be a dangling key rather than an absent one.
  it('treats an unset classification as nothing selected', async () => {
    const bare = new Product('Gadget');
    bare.id = 'p-3';
    repositories.product = makeInMemoryEntityRepository([bare] as Entity[]);
    slug = 'p-3';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Gadget'),
    );
    expect(held()).toHaveTextContent('sin asignar');
  });

  it('writes the picked target’s id into the record', async () => {
    const bare = new Product('Gadget');
    bare.id = 'p-3';
    repositories.product = makeInMemoryEntityRepository([bare] as Entity[]);
    slug = 'p-3';
    const user = userEvent.setup();
    renderPage(<productCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Gadget'),
    );

    // The picker labels itself from the *target's* `@entity({ labelKey })`.
    await user.type(screen.getByLabelText('Buscar Marca'), 'Acme');
    await user.click(await screen.findByRole('option', { name: 'Acme' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect((repositories.product.items[0] as Product).brandId).toBe('b-1');
  });
});
