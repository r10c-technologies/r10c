import { EntityColumn } from '@r10c/entifix-react-controls';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import type { TransactionSink } from '@r10c/entifix-transactions';
import { TransactionSinkTag } from '@r10c/entifix-transactions';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  accessor,
  EntifixBuildError,
  EntifixConnError,
  EntifixLogicError,
  type Entity,
  entity,
  type EntityDraft,
  type EntityId,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect, Option } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingState } from '../workspace/pending-state.js';
import { PendingTransactionsProvider } from '../workspace/pending-transactions.js';
import { makeEntityCrud } from './make-entity-crud';
import { CATALOG_NEW_SLUG } from './slug';

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

/**
 * A draft store double. `save`/`clear` are stable identities because the port
 * requires it: `useEntityForm` autosaves from an effect keyed on `save`.
 */
function draftStore(draft?: EntityDraft) {
  return { draft, save: vi.fn(), clear: vi.fn() };
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

/**
 * The entity-bound half of the same opt-in. Separate again, because a crud
 * carrying `runUseCase` must be shown to render *and run* the verb while
 * `brandCrud`, which carries neither option, goes on rendering none.
 */
const runVerb = vi.fn();

const verbBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  configuration: 'configurationStore',
  hiddenFields: ['id', 'code'],
  metadataSource: { fetchMetadata: () => fetchMetadata() },
  runUseCase: (key, id) => runVerb(key, id),
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
  runVerb.mockReset();
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

  // `MetaEntityOptions` makes both keys optional, and a screen generated without
  // them titles its tabs `undefined` — at render, on a surface nobody generated
  // deliberately, rather than here where the entity was handed over.
  it('rejects an entity that declares no label or plural key', () => {
    @entity({ domain: 'testing', key: 'product-category' })
    class Unnamed implements Entity {
      #id?: EntityId;

      @accessor({ type: 'id', label: 'ID' })
      get id(): EntityId | undefined {
        return this.#id;
      }
      set id(value: EntityId | undefined) {
        this.#id = value;
      }
    }

    expect(() =>
      makeEntityCrud<Unnamed, TestAdapters>(Unnamed, {
        useAdapters,
        basePath: '/catalog/product-category',
        catalogKey: 'product-category',
        repository: 'brandRest',
        configuration: 'configurationStore',
      }),
    ).toThrow(/labelKey and pluralKey/);
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

  it('names the entity from its own catalog subtree, singular and plural', () => {
    // A list tab is titled with the plural and a record tab with the label, so
    // both are computed here rather than restated at the registry — which is
    // what let three const maps disagree about what a product is called.
    expect(brandCrud.entityLabelKey).toBe('entity:product-brand.label');
    expect(brandCrud.entityPluralKey).toBe('entity:product-brand.plural');
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

  /**
   * ⚠️ The defect this option exists for, measured live on `ProductOffering`:
   * `EntityForm` has rendered these buttons since ADR 0035 and `EntityCrudForm`
   * has accepted an `onUseCase` for as long, but `makeEntityCrud` never passed
   * one — so a declared, granted, `$metadata`-served verb appeared on the form
   * and did nothing at all when clicked.
   */
  it('runs an entity-bound verb on the record it is showing', async () => {
    slug = 'b-1';
    runVerb.mockClear();
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    // Resolving means the record changed, so the verb rewrites it in the store
    // and the assertion is that the *form* caught up. Asserting only that the
    // runner was called would pass against a page that never reloads and goes
    // on showing the old state — which reads as "the button did nothing".
    runVerb.mockImplementation(async () => {
      await Effect.runPromise(
        repositories.brand
          .save(makeBrand('b-1', 'Acme Publicada', 'brand-001'))
          .pipe(
            // The in-memory adapter threads the configuration requirement it
            // never uses on this path, the same as every other caller here.
            Effect.provideService(
              ConfigurationRepositoryTag,
              makeStubConfigurationClient(),
            ),
          ),
      );
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    const button = await screen.findByRole('button', { name: /retirar/i });
    fireEvent.click(button);

    await waitFor(() => expect(runVerb).toHaveBeenCalledWith('publish', 'b-1'));
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme Publicada'),
    );
  });

  /**
   * ⚠️ Measured live: an offering refusing `unpublish` from `draft` answered
   * `409` with a coded body, the record correctly did not move — and the
   * operator saw nothing at all, because `onUseCase` returns `void` and the
   * rejection went to the console. A verb that fails silently is
   * indistinguishable from a button that is not wired.
   */
  it('shows a refused verb’s coded message instead of dropping it', async () => {
    slug = 'b-1';
    runVerb.mockClear();
    runVerb.mockRejectedValueOnce(
      new EntifixLogicError('refused', undefined, {
        code: 'alreadyRetired',
      }),
    );
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /retirar/i }));

    // The `errors` catalog's Spanish copy for that code, resolved through
    // `useErrorMessage` — not the thrown message, which nobody wrote for a user.
    await waitFor(() =>
      expect(screen.getByText(/ya estaba retirado/i)).toBeVisible(),
    );
  });

  /**
   * A rejection that is not an `EntifixError` keeps its own message rather than
   * being relabelled with a code it never had: `useErrorMessage` falls back to
   * the message when `details.code` is absent, so inventing one here would
   * render the wrong catalog sentence with full confidence.
   */
  it.each([
    ['a plain Error', new Error('la red falló'), 'la red falló'],
    ['a thrown string', 'la red falló', 'la red falló'],
  ])('keeps the message of %s', async (_name, thrown, expected) => {
    slug = 'b-1';
    runVerb.mockRejectedValueOnce(thrown);
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /retirar/i }));

    await waitFor(() => expect(screen.getByText(expected)).toBeVisible());
  });

  /**
   * ⚠️ This assertion was **vacuous** when first written: it awaited the create
   * title and then queried, while `fetchMetadata` was still in flight — so it
   * passed against a form that did render the verbs, which is exactly what the
   * live pass then found. Awaiting a metadata-dependent element first is what
   * makes the negative claim mean anything.
   */
  it('offers no verb on a create, where there is no record to act on', async () => {
    // `new` is the create slug; the page resolves it to a null id.
    slug = CATALOG_NEW_SLUG;
    runVerb.mockClear();
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    // Save is gated on the same metadata document the verbs come from, so its
    // arrival proves the fetch resolved and the absence below is a decision
    // rather than a race.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /guardar/i })).toBeVisible(),
    );
    expect(screen.queryByRole('button', { name: /retirar/i })).toBeNull();
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
    const store = draftStore({ name: 'Hooli' });
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage draft={store} />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Hooli'),
    );
    await user.type(screen.getByLabelText(/nombre/i), '!');
    await waitFor(() => expect(store.save).toHaveBeenCalled());
  });

  // The draft is spent once the write commits, and this page is the only place
  // that knows it did — `useEntityForm` neither fetches nor saves.
  it('clears the draft once a save commits', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });

  it('clears the draft once a delete commits', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });

  /**
   * A failed write leaves the draft alone: what the user typed is still their
   * only copy of it, and clearing here would discard the edit at the exact
   * moment they need to retry it.
   */
  it('keeps the draft when the save fails', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    repositories.brand.failNext(new EntifixConnError('unreachable'));

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(screen.getByTestId(/form-error$/)).toBeInTheDocument(),
    );
    expect(store.clear).not.toHaveBeenCalled();
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

/**
 * The optimistic branch: a save whose id is being watched has not committed yet.
 *
 * The pending set is seeded directly rather than driven through the save
 * adapter, because the in-memory repository these specs run on never reaches
 * it — that the adapter registers exactly the transactional creates is its own
 * spec's job (`build-entity-rest-adapter-save`). What is asserted here is the
 * branch this file owns: given an id in the pending set, the draft survives and
 * the row is rendered before the write lands.
 */
describe('the generated form, saving a write that is still in flight', () => {
  const withPending = (page: ReactElement) =>
    render(
      <EntifixQueryProvider>
        <PendingTransactionsProvider scope="user-1:org-1">
          {page}
        </PendingTransactionsProvider>
      </EntifixQueryProvider>,
    );

  beforeEach(() => {
    usePendingState.setState({ pending: {} });
    vi.spyOn(usePendingState.persist, 'rehydrate').mockResolvedValue(undefined);
  });

  const watch = (transactionId: string) =>
    usePendingState.getState().began({
      transactionId,
      entity: 'product-brand',
      at: '2026-09-02T00:00:00.000Z',
    });

  // The fix for the silent input loss: a create resolves at the `202`, so
  // clearing here would destroy the operator's only copy of what they typed
  // minutes before the transaction actually failed.
  it('keeps the draft, because the write has not committed', async () => {
    slug = 'b-1';
    watch('b-1');
    const store = draftStore();
    const user = userEvent.setup();

    withPending(<brandCrud.SingleViewPage draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(store.clear).not.toHaveBeenCalled();
  });

  // The unwatched path is unchanged: a plain REST save is durable when it
  // answers, so the draft is spent and nothing is patched.
  it('still clears the draft for a write that is already durable', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    withPending(<brandCrud.SingleViewPage draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });
});

/**
 * ⚠️ The guard the type system cannot give.
 *
 * The sink is read with `Effect.serviceOption`, which erases the tag from the
 * adapter's `R` — that is what keeps every existing caller compiling with no
 * layer to provide, and it is also why **nothing forces the composition root to
 * provide it**. Forget to, and the read returns `None`, everything type-checks,
 * the adapter's own spec still reaches 100% on both arms, and the feature is
 * silently dead. So the wiring is asserted where it is done.
 */
describe('the context the generated pages run their use-cases in', () => {
  it('carries a transaction sink, so an announcement has somewhere to go', async () => {
    let seen: Option.Option<TransactionSink> | undefined;

    // A repository whose only job is to report what it can see in context —
    // driven through the real `SingleViewPage`, so what is asserted is the
    // context `mergeContext` actually built rather than a re-derivation of it.
    repositories.brand = {
      ...repositories.brand,
      save: () =>
        Effect.gen(function* () {
          seen = yield* Effect.serviceOption(TransactionSinkTag);
          return yield* Effect.succeed(makeBrand('b-1', 'Acme', 'brand-001'));
        }),
    } as ReturnType<typeof makeInMemoryEntityRepository>;

    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(seen).toBeDefined());
    expect(Option.isSome(seen!)).toBe(true);
  });
});
