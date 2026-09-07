import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  accessor,
  type CommandSource,
  type Entity,
  entity,
  type EntityId,
  type EntityMetadataDocument,
  type EntityMetadataSource,
} from '@r10c/entifix-ts-core';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type UseCaseCommandEntity,
  useUseCaseSources,
} from './use-use-cases-source.js';

/** A stand-in effect. An empty arrow body is a lint error; this is deliberate. */
const noop = async (): Promise<void> => undefined;

@entity({
  domain: 'authn',
  key: 'palette-subject',
  labelKey: 'entity:user-identity.label',
})
class PaletteSubject implements Entity {
  #id?: EntityId;
  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const document = (
  useCases: EntityMetadataDocument['useCases'],
): EntityMetadataDocument => ({ actions: ['read'], useCases });

const SIGN_OUT = {
  key: 'sign-out-others',
  binding: 'unbound' as const,
  placement: 'context-independent' as const,
  labelKey: 'entity:user-identity.useCases.signOutOthers',
  keywordsKey: 'entity:user-identity.useCases.signOutOthersKeywords',
  confirm: {
    tone: 'destructive' as const,
    messageKey: 'entity:user-identity.useCases.signOutOthersConfirm',
  },
};

const sourceFor = (
  useCases: EntityMetadataDocument['useCases'],
  handlers: Record<string, () => Promise<void>>,
) => {
  const metadataSource: EntityMetadataSource = {
    fetchMetadata: async () => document(useCases),
  };
  const entities: readonly UseCaseCommandEntity[] = [
    { entityConstructor: PaletteSubject, metadataSource, handlers },
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EntifixQueryProvider>{children}</EntifixQueryProvider>
  );
  return renderHook(() => useUseCaseSources(entities, ''), { wrapper });
};

const options = (sources: CommandSource[]) => sources[0].groups[0].options;

class Boundary extends Component<
  { children: ReactNode },
  { message?: string }
> {
  override state: { message?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  override render() {
    return this.state.message === undefined ? (
      this.props.children
    ) : (
      <div data-testid="boundary">{this.state.message}</div>
    );
  }
}

describe('useUseCaseSources', () => {
  it('renders the verbs the service says this caller may invoke', async () => {
    const run = vi.fn(noop);
    const { result } = sourceFor([SIGN_OUT], { 'sign-out-others': run });

    await waitFor(() => expect(options(result.current)).toHaveLength(1));
    const option = options(result.current)[0];
    expect(option.id).toBe('use-case:palette-subject:sign-out-others');
    expect(option.label).toBe('Cerrar mis otras sesiones');
    expect(option.run).toBe(run);
  });

  it('resolves the descriptor’s keywords through the catalog', async () => {
    const { result } = sourceFor([SIGN_OUT], {
      'sign-out-others': noop,
    });

    await waitFor(() => expect(options(result.current)).toHaveLength(1));
    expect(options(result.current)[0].keywords).toContain('logout');
  });

  it('carries the confirmation the descriptor declared', async () => {
    const { result } = sourceFor([SIGN_OUT], {
      'sign-out-others': noop,
    });

    await waitFor(() => expect(options(result.current)).toHaveLength(1));
    expect(options(result.current)[0].confirm).toEqual({
      tone: 'destructive',
      message:
        'Se cerrarán todas tus sesiones en otros dispositivos y navegadores. Ésta seguirá abierta.',
    });
  });

  it('carries no confirmation and no keywords where the descriptor declared none', async () => {
    const { result } = sourceFor(
      [{ ...SIGN_OUT, keywordsKey: undefined, confirm: undefined }],
      { 'sign-out-others': noop },
    );

    await waitFor(() => expect(options(result.current)).toHaveLength(1));
    expect(options(result.current)[0].confirm).toBeUndefined();
    expect(options(result.current)[0].keywords).toEqual([]);
  });

  it('drops a verb that belongs to another surface', async () => {
    const { result } = sourceFor(
      [{ ...SIGN_OUT, binding: 'entity' as const }],
      { 'sign-out-others': noop },
    );

    await waitFor(() => expect(result.current[0].groups[0].isLoading).toBe(false));
    expect(options(result.current)).toEqual([]);
  });

  it('reports the wait rather than an empty group while metadata is in flight', () => {
    const { result } = sourceFor([SIGN_OUT], {
      'sign-out-others': noop,
    });

    expect(result.current[0].groups[0].isLoading).toBe(true);
  });

  it('refuses a verb this host registered no handler for', async () => {
    // A verb that appears and does nothing reads as a broken feature rather than
    // a missing wire, so it fails loudly during the render instead. It is caught
    // through a boundary because that is where a render-time throw lands — a
    // `toThrow` around the hook would assert on the render *before* the
    // descriptors arrived.
    const metadataSource: EntityMetadataSource = {
      fetchMetadata: async () => document([SIGN_OUT]),
    };
    const entities: readonly UseCaseCommandEntity[] = [
      { entityConstructor: PaletteSubject, metadataSource, handlers: {} },
    ];
    function Subject() {
      useUseCaseSources(entities, '');
      return null;
    }
    vi.spyOn(console, 'error').mockImplementation(noop);

    render(
      <Boundary>
        <EntifixQueryProvider>
          <Subject />
        </EntifixQueryProvider>
      </Boundary>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('boundary').textContent).toMatch(
        /registered no handler/,
      ),
    );
  });

  it('contributes nothing when no entity was declared', () => {
    const { result } = renderHook(() => useUseCaseSources([], ''));

    expect(result.current).toEqual([]);
  });
});
