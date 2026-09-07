import 'fake-indexeddb/auto';

import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  assertWizardDefinition,
  EntifixConnError,
  type Entity,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { useDraftsState } from '@r10c/shells-next-common';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';
import {
  PRODUCT_SETUP_WIZARD,
  ProductSetupWizard,
  validatorFor,
} from './product-setup-wizard.js';

/**
 * A router that actually navigates.
 *
 * `useSearchParams` has to reflect what was pushed: the wizard writes the step
 * into the address and *follows* the address back, so a mock that pushes into a
 * void leaves the two permanently disagreeing — the follower reads a missing
 * step as the flow's beginning and rewinds every advance.
 */
let search = new URLSearchParams();
const push = vi.fn((url: string) => {
  search = new URLSearchParams(new URL(url, 'http://localhost').search);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => '/es/wizards/product-setup',
  useSelectedLayoutSegments: () => ['wizards', 'product-setup'],
  useSearchParams: () => search,
  useParams: () => ({}),
}));

const ADDRESS = 'wizard:product-setup';

const makeProduct = (id: string, code: string, name: string) => {
  const product = new ProductSpecification(code, name);
  product.id = id;
  product.description = `${name} descrito`;
  product.brandId = 'b-1';
  product.categoryId = 'c-1';
  return product;
};

const makeBrand = () => {
  const brand = new ProductBrand('Acme');
  brand.id = 'b-1';
  return brand;
};

const makeCategory = () => {
  const category = new ProductCategory('C-1', 'Herramientas');
  category.id = 'c-1';
  return category;
};

let repositories: {
  product: ReturnType<typeof makeInMemoryEntityRepository>;
  brand: ReturnType<typeof makeInMemoryEntityRepository>;
  category: ReturnType<typeof makeInMemoryEntityRepository>;
};

const adapters = (): MarketplaceAdminAdapters => ({
  productRest: Context.make(EntityRepositoryTag, repositories.product),
  productBrandRest: Context.make(EntityRepositoryTag, repositories.brand),
  productCategoryRest: Context.make(EntityRepositoryTag, repositories.category),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderWizard = (props: { step?: string; onFinished?: () => void } = {}) =>
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider adapters={adapters()}>
        <ProductSetupWizard {...props} />
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
  );

const click = async (name: string | RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }));
};

const type = async (label: string | RegExp, value: string) => {
  await userEvent.type(screen.getByLabelText(label), value);
};

beforeEach(() => {
  push.mockClear();
  search = new URLSearchParams();
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
  repositories = {
    product: makeInMemoryEntityRepository([
      makeProduct('p-1', 'P-1', 'Widget'),
      makeProduct('p-2', 'P-2', 'Gadget'),
    ] as Entity[]),
    brand: makeInMemoryEntityRepository([makeBrand()] as Entity[]),
    category: makeInMemoryEntityRepository([makeCategory()] as Entity[]),
  };
});

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

describe('the definition', () => {
  it('is checked at module load, not on the step nobody reaches', () => {
    expect(() => assertWizardDefinition(PRODUCT_SETUP_WIZARD)).not.toThrow();
    expect(PRODUCT_SETUP_WIZARD.steps.at(-1)?.kind).toBe('summary');
  });
});

describe('the blank path', () => {
  it('projects four steps and hides the one only the other branch reaches', async () => {
    renderWizard();

    const steps = await screen.findAllByRole('listitem');
    expect(steps.map(step => step.textContent)).toEqual([
      expect.stringContaining('Origen'),
      expect.stringContaining('Identificación'),
      expect.stringContaining('Clasificación'),
      expect.stringContaining('Resumen'),
    ]);
  });

  it('refuses to advance past a step whose required member is empty', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');

    // `name` is required and this is the step that owns it. `code` is not asked
    // for at all — the create transaction assigns it.
    expect(await screen.findByLabelText(/Nombre/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Código/)).not.toBeInTheDocument();
    await click('Continuar');

    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Nombre/)).toBeInTheDocument();
  });

  it('validates only the members the step owns', async () => {
    // The classification step must not be blocked by `name`, which belongs to
    // the step before it — without a scope, no step but the last could advance.
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');

    expect(
      await screen.findByRole('heading', { name: 'Clasificación' }),
    ).toBeInTheDocument();

    await click('Continuar');

    expect(
      await screen.findByRole('heading', { name: 'Resumen' }),
    ).toBeInTheDocument();
  });

  it('recaps what was answered and hands the create off', async () => {
    const onFinished = vi.fn();
    renderWizard({ onFinished });

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Continuar');

    expect(await screen.findByText('Café')).toBeInTheDocument();
    expect(screen.getByText('Desde cero')).toBeInTheDocument();
    // The service assigns the code, so the repaso never claims one.
    expect(screen.queryByText(/^P-/)).not.toBeInTheDocument();

    await click('Finalizar');

    await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
    expect(
      repositories.product.items.map(item => (item as ProductSpecification).name),
    ).toContain('Café');
  });
});

describe('finishing without a host to return to', () => {
  it('navigates back to the product list, locale and all', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Continuar');
    await click('Finalizar');

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/es/catalog/product'),
    );
  });
});

describe('the stepper', () => {
  it('jumps back to a completed step when one is clicked', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');

    await click('Volver a Identificación');

    expect(await screen.findByLabelText(/Nombre/)).toHaveValue('Café');
  });
});

describe('the duplicate path', () => {
  it('adds the table step and seeds the forms from the row that was picked', async () => {
    renderWizard();

    await click(/Duplicar uno existente/);
    expect(await screen.findAllByRole('listitem')).toHaveLength(5);

    await click('Continuar');
    const rows = await screen.findAllByRole('row');
    const gadget = rows.find(row => within(row).queryByText('Gadget') !== null);
    await userEvent.click(
      within(gadget as HTMLElement).getByRole('button', {
        name: 'Seleccionar',
      }),
    );

    await click('Continuar');

    // Seeded from the source. The code is neither shown nor carried: it
    // identifies the original, and the service assigns the copy its own.
    expect(await screen.findByLabelText(/Nombre/)).toHaveValue('Gadget');
    expect(screen.queryByLabelText(/Código/)).not.toBeInTheDocument();
  });

  it('names the record it was duplicated from in the summary', async () => {
    renderWizard();

    await click(/Duplicar uno existente/);
    await click('Continuar');
    const rows = await screen.findAllByRole('row');
    const gadget = rows.find(row => within(row).queryByText('Gadget') !== null);
    await userEvent.click(
      within(gadget as HTMLElement).getByRole('button', {
        name: 'Seleccionar',
      }),
    );
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Continuar');

    expect(await screen.findByText(/Duplicado de p-2/)).toBeInTheDocument();
  });

  it('names the brand in the summary rather than showing its id', async () => {
    // The draft holds ids and the picking step has unmounted, so the repaso
    // resolves them again. Showing `b-1` is exactly the check the step exists
    // to let someone make, failed.
    renderWizard();

    await click(/Duplicar uno existente/);
    await click('Continuar');
    const rows = await screen.findAllByRole('row');
    const gadget = rows.find(row => within(row).queryByText('Gadget') !== null);
    await userEvent.click(
      within(gadget as HTMLElement).getByRole('button', {
        name: 'Seleccionar',
      }),
    );
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Continuar');

    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.queryByText('b-1')).not.toBeInTheDocument();
  });
});

describe('a write the service refuses', () => {
  it('keeps the operator on the summary with everything they typed', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Continuar');

    repositories.product.failNext(new EntifixConnError('nope'));
    await click('Finalizar');

    // The step pushes are the address sync; what must not happen is leaving.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Resumen' }),
      ).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalledWith('/es/catalog/product');
    expect(screen.getByText('Café')).toBeInTheDocument();
  });
});

describe('going back', () => {
  it('keeps an earlier step’s answers, because the draft lives above the form', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');
    await type(/Nombre/, 'Café');
    await click('Continuar');
    await click('Atrás');

    expect(await screen.findByLabelText(/Nombre/)).toHaveValue('Café');
  });
});

describe('the address', () => {
  it('writes the step it moved to, so browser-Back moves a step', async () => {
    renderWizard();

    await click(/Desde cero/);
    await click('Continuar');

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/es/wizards/product-setup?step=identity',
      ),
    );
  });

  it('opens at a step the address named, once it is on the path', async () => {
    // A workspace tab addressed `wizard:product-setup:identity`. `goTo` moves
    // only to a step already walked, so a fresh flow still starts at the top —
    // skipping forward would skip the validation in between.
    renderWizard({ step: 'identity' });

    expect(
      await screen.findByRole('heading', { name: 'Origen' }),
    ).toBeInTheDocument();
  });
});

describe('resuming', () => {
  it('picks up where it was left and says what was already answered', async () => {
    useDraftsState.getState().setDraft(ADDRESS, {
      activeStep: 'classification',
      history: ['start', 'identity'],
      steps: {
        start: { kind: 'choice', option: 'blank' },
        identity: { kind: 'form', values: { name: 'Té' } },
      },
    });

    renderWizard();

    expect(
      await screen.findByRole('heading', { name: 'Clasificación' }),
    ).toBeInTheDocument();
    const recap = screen.getByTestId('wizard-recap');
    expect(recap).toHaveTextContent('Té');
  });

  it('names the brand in the recap rather than showing its id', async () => {
    // A recap exists because a returning operator cannot remember what they
    // chose, and `b-1` is not a reminder of anything.
    useDraftsState.getState().setDraft(ADDRESS, {
      activeStep: 'summary',
      history: ['start', 'identity', 'classification'],
      steps: {
        start: { kind: 'choice', option: 'blank' },
        identity: { kind: 'form', values: { name: 'Té' } },
        classification: { kind: 'form', values: { brandId: 'b-1' } },
      },
    });

    renderWizard();

    const recap = await screen.findByTestId('wizard-recap');
    await waitFor(() => expect(recap).toHaveTextContent('Acme'));
    expect(recap).not.toHaveTextContent('b-1');
  });
});

describe('validatorFor', () => {
  const passes = { stepId: 'identity', validate: async () => true };

  it('asks the step that registered, when it is the one on screen', async () => {
    await expect(validatorFor('identity', passes)()).resolves.toBe(true);
  });

  it('reports what that step answered', async () => {
    const fails = { stepId: 'identity', validate: async () => false };

    await expect(validatorFor('identity', fails)()).resolves.toBe(false);
  });

  it('lets a step with nothing to validate through', async () => {
    // The branch point, the table and the summary own no form.
    await expect(validatorFor('start', undefined)()).resolves.toBe(true);
    await expect(validatorFor('summary', undefined)()).resolves.toBe(true);
  });

  it('refuses a form step whose validator has not registered yet', async () => {
    // The window between leaving one step and the next one mounting. Treating
    // it as "nothing to check" is what let two quick presses of Continuar skip
    // the identity step's required members entirely.
    await expect(validatorFor('identity', undefined)()).resolves.toBe(false);
    await expect(validatorFor('classification', passes)()).resolves.toBe(false);
  });
});
