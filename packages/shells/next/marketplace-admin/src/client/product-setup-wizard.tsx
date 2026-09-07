'use client';

import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  Button,
  Card,
  Cluster,
  EntityField,
  EntityForm,
  EntityTable,
  Stack,
  Text,
  useTranslateKey,
  Wizard,
} from '@r10c/entifix-react-controls';
import {
  seedEntityDraft,
  useDataLoading,
  useEntityForm,
  useEntityMutation,
  useWizard,
} from '@r10c/entifix-react-integration';
import type { TransactionSink } from '@r10c/entifix-transactions';
import {
  deleteUCFactory,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import {
  assertWizardDefinition,
  cloneEntityDraft,
  describeEntityColumns,
  type EntityDraft,
  type EntityFieldDescriptor,
  readStepChoice,
  readStepDraft,
  readStepIds,
  reconstructEntity,
  type WizardDefinition,
} from '@r10c/entifix-ts-core';
import type {
  CrudContext,
  EntityCrudLinkSource,
} from '@r10c/shells-next-common';
import {
  handOffWrite,
  mergeCrudContext,
  useEntityLinkSources,
  useFollowWizardStepUrl,
  useLocaleHref,
  usePendingTransactions,
  useWizardDraft,
  useWizardStepUrl,
} from '@r10c/shells-next-common';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { PRODUCT_SURFACE } from '../catalog-surfaces';
import { PRODUCT_SETUP_SURFACE, wizardAddress } from '../wizard-surfaces';
import type { MarketplaceAdminAdapters } from './client-types';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/**
 * The classification step's two pickers.
 *
 * Declared at module scope and **frozen**, which is what makes
 * `useEntityLinkSources`' loop legal: it is the same array object on every
 * render, so the hook count is fixed — the invariant `rules-of-hooks` protects
 * and cannot see. `NO_PICKERS` is the same object every time for the same
 * reason, so the identity step calls exactly as many hooks as this one.
 *
 * Both targets live in `catalog-reference`, another slice's store, so
 * `brandId`/`categoryId` are plain `string` members and the label and search
 * properties are stated here — a scalar id's `@accessor()` cannot name them
 * (ADR 0022).
 */
const NO_PICKERS: readonly EntityCrudLinkSource[] = [];

/** The descriptor half of each picker, resolved once from the entity's metadata. */
const PICKER_PLANS = [
  {
    field: 'brandId',
    entityConstructor: ProductBrand,
    repository: 'productBrandRest',
  },
  {
    field: 'categoryId',
    entityConstructor: ProductCategory,
    repository: 'productCategoryRest',
  },
] as const;

/**
 * The classification step's pickers, rebuilt per render.
 *
 * Rebuilding is safe and is what `makeEntityCrud` does too: `useEntityLinkSource`
 * holds these in a ref and keeps them out of its query keys, so what has to stay
 * fixed is the array's **length**, not its identity — which is why `FormStep`
 * carries a `key` and remounts between steps rather than swapping a two-picker
 * list for an empty one under the same instance.
 */
function pickersFor(
  adapters: MarketplaceAdminAdapters,
  pending: TransactionSink,
): readonly EntityCrudLinkSource[] {
  const descriptors = describeEntityColumns(ProductSpecification);

  return PICKER_PLANS.map(plan => ({
    field: plan.field,
    descriptor: {
      ...(descriptors.find(
        entry => entry.name === plan.field,
      ) as EntityFieldDescriptor),
      // Stated rather than defaulted: a plain foreign key's `@accessor()` cannot
      // name the target's members, because the domain may not import the one
      // that owns them (ADR 0022). `name` is `filterable` on both targets, which
      // is what keeps the suggestion query out of a `400`.
      linkLabelProperty: 'name',
      linkSearchProperty: 'name',
    },
    config: {
      entityConstructor: plan.entityConstructor,
      loadUc: loadUCFactory(),
      getUc: getUCFactory(),
      ctx: mergeCrudContext(
        adapters,
        'configurationStore',
        plan.repository,
        pending,
      ),
    },
  }));
}

/**
 * Which members each form step owns. Their union is what the submit rebuilds.
 *
 * `code` is **not** among them: the create transaction assigns it from a
 * sequence, so asking for one would put a field on a step of its own, require
 * it, show it in the summary, and then discard it.
 */
const IDENTITY_FIELDS = ['name', 'description'] as const;
const CLASSIFICATION_FIELDS = ['brandId', 'categoryId'] as const;

/**
 * The guided alta of a product.
 *
 * A **branch that is real rather than illustrative**: starting from an existing
 * product is a thing operators actually do, and it is what makes the table step
 * and `cloneEntityDraft` load-bearing here instead of decoration.
 *
 * The flow converges: both branches end in the same two form steps, which is
 * what a graph buys over an index — the shared tail is declared once and the
 * stepper still shows four steps on one path and five on the other.
 */
export const PRODUCT_SETUP_WIZARD: WizardDefinition = {
  key: PRODUCT_SETUP_SURFACE.key,
  steps: [
    {
      id: 'start',
      kind: 'choice',
      labelKey: 'shell:marketplaceAdmin.wizard.productSetup.steps.start',
      options: ['blank', 'duplicate'],
      to: ['identity', 'source'],
      next: state =>
        state.steps.start !== undefined &&
        (state.steps.start as { option?: string }).option === 'duplicate'
          ? 'source'
          : 'identity',
    },
    {
      id: 'source',
      kind: 'selection',
      labelKey: 'shell:marketplaceAdmin.wizard.productSetup.steps.source',
      to: ['identity'],
    },
    {
      id: 'identity',
      kind: 'form',
      labelKey: 'shell:marketplaceAdmin.wizard.productSetup.steps.identity',
      to: ['classification'],
    },
    {
      id: 'classification',
      kind: 'form',
      labelKey:
        'shell:marketplaceAdmin.wizard.productSetup.steps.classification',
      to: ['summary'],
    },
    {
      id: 'summary',
      kind: 'summary',
      labelKey: 'shell:marketplaceAdmin.wizard.productSetup.steps.summary',
      to: [],
    },
  ],
};

// At module load, so a malformed definition fails on the first render of any
// surface rather than on the render of the step nobody reached.
assertWizardDefinition(PRODUCT_SETUP_WIZARD);

/**
 * The steps whose advance is gated by a form of their own.
 *
 * Derived from the definition rather than listed, so a sixth step declared
 * `form` is gated by declaring it.
 */
const GATED_STEPS = new Set(
  PRODUCT_SETUP_WIZARD.steps
    .filter(step => step.kind === 'form')
    .map(step => step.id),
);

/** A step's own validator, registered by the step that owns it. */
export interface RegisteredGate {
  readonly stepId: string;
  readonly validate: () => Promise<boolean>;
}

/**
 * What a press of Continuar has to satisfy on this step.
 *
 * ⚠️ **A form step whose validator has not registered yet answers `false`**, and
 * that is not defensiveness. A step registers from an effect, so between leaving
 * one step and the next one mounting there is a window with no validator at all
 * — and treating "no validator" as "nothing to check" walks straight through it.
 * Measured end to end: two quick presses of Continuar skipped the identity
 * step's required members entirely. A step that cannot be answered yet is one
 * the press does nothing on.
 *
 * A step that is *not* a form — the branch point, the table, the summary — has
 * nothing to validate and passes.
 */
export const validatorFor =
  (activeStep: string, registered: RegisteredGate | undefined) =>
  async (): Promise<boolean> =>
    registered?.stepId === activeStep
      ? registered.validate()
      : !GATED_STEPS.has(activeStep);

export interface ProductSetupWizardProps {
  /** The step the address named, when it named one. */
  readonly step?: string;
  /** Where to go once the create has been handed off. Defaults to the list. */
  readonly onFinished?: () => void;
}

/**
 * The wizard, wired to the catalog's adapters.
 *
 * Dual-host like every generated page: as a route it returns to the product
 * list, in a workspace tab the host says where to go. Both inherit the pending
 * set and the SSE settlement from `providers.tsx`, which is why the ending needs
 * nothing of its own.
 */
export function ProductSetupWizard({
  step,
  onFinished,
}: ProductSetupWizardProps = {}) {
  const translateKey = useTranslateKey();
  const adapters = useMarketplaceAdminAdapters();
  const pending = usePendingTransactions();
  const router = useRouter();
  const withLocale = useLocaleHref();

  const ctx = mergeCrudContext(
    adapters,
    'configurationStore',
    'productRest',
    pending,
  );

  const draft = useWizardDraft(wizardAddress(PRODUCT_SETUP_SURFACE));

  // The writer comes first and is handed to `useWizard` **directly**: the push
  // has to land in the same commit as the move, or the follower below sees the
  // address and the active step disagree and reads it as a Back.
  const writeStep = useWizardStepUrl();
  const wizard = useWizard({
    definition: PRODUCT_SETUP_WIZARD,
    draft,
    onStepChange: writeStep,
  });
  useFollowWizardStepUrl({
    activeStep: wizard.activeStep,
    entryStep: PRODUCT_SETUP_WIZARD.steps[0].id,
    goTo: wizard.goTo,
  });

  /**
   * The address may name a step the host opened at — a workspace tab addressed
   * `wizard:product-setup:identity`.
   *
   * Honoured **once**, and only when it is on the path already walked, which is
   * `goTo`'s own rule: a fresh flow still starts at the top, because skipping
   * forward would skip the validation in between.
   */
  const opened = useRef(false);
  const goTo = wizard.goTo;
  useEffect(() => {
    if (opened.current || step === undefined) return;
    opened.current = true;
    goTo(step);
  }, [step, goTo]);

  const { save, isSaving } = useEntityMutation<
    ProductSpecification,
    CrudContext
  >({
    saveUc: saveUCFactory<ProductSpecification>(),
    // A wizard creates; it never deletes. The factory is named because the
    // option is required, and `remove` is simply not read.
    deleteUc: deleteUCFactory<ProductSpecification>(),
    ctx,
  });

  /**
   * The active step's own validation, registered by the step that owns it.
   *
   * "Continuar" *is* a form step's submit, and only that step's `useEntityForm`
   * knows whether it passed — the step is a component precisely because React's
   * hook count must stay fixed, so the answer has to come back up rather than be
   * computed here.
   *
   * It records **which step** registered, which is what lets
   * {@link validatorFor} tell "this step says it is fine" from "no step has
   * said anything yet".
   */
  const gate = useRef<RegisteredGate | undefined>(undefined);
  const registerGate = useCallback(
    (stepId: string, validate: (() => Promise<boolean>) | undefined) => {
      gate.current = validate === undefined ? undefined : { stepId, validate };
    },
    [],
  );

  const advance = async () => {
    if (await validatorFor(wizard.activeStep, gate.current)()) wizard.next();
  };

  const finish = async () => {
    const values: EntityDraft = {
      ...readStepDraft(wizard.state, 'identity'),
      ...readStepDraft(wizard.state, 'classification'),
    };
    const saved = await save(reconstructEntity(ProductSpecification, values));
    if (saved === undefined) return;

    // The same hand-off every generated create performs, through the same
    // helper: a still-pending write keeps what the operator typed, and only a
    // committed one spends it.
    handOffWrite({ id: String(saved.id), record: saved, pending, draft });

    if (onFinished !== undefined) {
      onFinished();
      return;
    }
    router.push(withLocale(PRODUCT_SURFACE.basePath));
  };

  return (
    <Wizard
      steps={wizard.steps.map(({ id, status }) => ({
        id,
        label: translateKey(STEP_LABEL_KEYS[id]),
        status,
      }))}
      activeStep={wizard.activeStep}
      title={translateKey(STEP_LABEL_KEYS[wizard.activeStep])}
      canFinish={wizard.canFinish}
      isSubmitting={isSaving}
      recap={
        wizard.isResumed ? (
          <Recap state={wizard.state} links={pickersFor(adapters, pending)} />
        ) : undefined
      }
      onNext={() => void advance()}
      onFinish={() => void finish()}
      onPrevious={
        wizard.state.history.length > 0 ? () => wizard.previous() : undefined
      }
      onStepChange={stepId => {
        // No URL write here, and no gate clearing: moving reports through
        // `onStepChange` above, which is the one place the address is written,
        // and the step component clears its own gate as it unmounts.
        wizard.goTo(stepId);
      }}
    >
      <StepBody
        wizard={wizard}
        ctx={ctx}
        pickers={pickersFor(adapters, pending)}
        registerGate={registerGate}
      />
    </Wizard>
  );
}

/**
 * Each step's catalog key, read off the definition once.
 *
 * A map rather than a lookup with a fallback: every id this is asked about comes
 * from the definition's own projected path, so a "step not found" arm would be
 * unreachable — and an unreachable arm is indistinguishable from an untested
 * one. Resolved through `useTranslateKey` at the call site, the escape hatch for
 * a **runtime** key: a step id is data, so `useT` cannot check it and
 * `@r10c/i18n-check` is what does.
 */
const STEP_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  PRODUCT_SETUP_WIZARD.steps.map(step => [step.id, step.labelKey]),
);

interface StepBodyProps {
  wizard: ReturnType<typeof useWizard>;
  ctx: ReturnType<typeof mergeCrudContext>;
  pickers: readonly EntityCrudLinkSource[];
  registerGate: (
    stepId: string,
    validate: (() => Promise<boolean>) | undefined,
  ) => void;
}

/**
 * ⚠️ The two form steps carry a **`key`**, so moving between them remounts.
 *
 * Both branches render `FormStep` at the same position, so without one React
 * would reuse the instance — and the two steps ask for a different number of
 * pickers, which is a changed hook count and a crash. The remount is wanted
 * anyway: `useEntityForm` seeds once, so a reused instance would show the
 * previous step's values.
 */
function StepBody({ wizard, ctx, pickers, registerGate }: StepBodyProps) {
  switch (wizard.activeStep) {
    case 'start':
      return <StartStep wizard={wizard} />;
    case 'source':
      return <SourceStep wizard={wizard} ctx={ctx} />;
    case 'identity':
      return (
        <FormStep
          key="identity"
          fields={IDENTITY_FIELDS}
          wizard={wizard}
          stepId="identity"
          links={NO_PICKERS}
          registerGate={registerGate}
        />
      );
    case 'classification':
      return (
        <FormStep
          key="classification"
          fields={CLASSIFICATION_FIELDS}
          wizard={wizard}
          stepId="classification"
          links={pickers}
          registerGate={registerGate}
        />
      );
    default:
      return <SummaryStep wizard={wizard} links={pickers} />;
  }
}

/**
 * The branch point: from scratch, or from a product already on file.
 *
 * Two buttons rather than a select, because the choice carries an explanation
 * each — chiefly that a duplicate does **not** carry the original's code, which
 * is the one thing an operator would otherwise discover by saving.
 */
function StartStep({ wizard }: { wizard: ReturnType<typeof useWizard> }) {
  const translateKey = useTranslateKey();
  const chosen = readStepChoice(wizard.state, 'start') ?? 'blank';
  const key = (leaf: string) =>
    `shell:marketplaceAdmin.wizard.productSetup.start.${leaf}`;

  return (
    <Card>
      <Stack gap="s">
        <Text weight="medium">{translateKey(key('question'))}</Text>
        <Cluster gap="xs" align="stretch">
          {(['blank', 'duplicate'] as const).map(option => (
            <Button
              key={option}
              type="button"
              variant={chosen === option ? 'primary' : 'secondary'}
              aria-pressed={chosen === option}
              onClick={() =>
                wizard.setStepValue('start', { kind: 'choice', option })
              }
            >
              <Stack gap="3xs" align="start" className="text-left">
                <span>{translateKey(key(option))}</span>
                <span className="text-step-xs opacity-80">
                  {translateKey(key(`${option}Hint`))}
                </span>
              </Stack>
            </Button>
          ))}
        </Cluster>
      </Stack>
    </Card>
  );
}

/**
 * The table step: pick the product to start from.
 *
 * `onSelect` and not `selection`, and the two are mutually exclusive by design
 * (ADR 0035) — this picks **one** record, so a multi-selection with a bulk bar
 * would offer an act the flow has no meaning for.
 *
 * Picking seeds the two form steps through `cloneEntityDraft`, which is what
 * drops the original's `id` and its `resetOnClone` code. Seeding here rather
 * than inside the identity step is deliberate: the step is unmounted while this
 * one is showing, and the draft lives above it precisely so that it can be
 * written before it mounts.
 */
function SourceStep({
  wizard,
  ctx,
}: {
  wizard: ReturnType<typeof useWizard>;
  ctx: ReturnType<typeof mergeCrudContext>;
}) {
  const translateKey = useTranslateKey();
  const chosen = readStepIds(wizard.state, 'source')[0];

  const pager = useDataLoading<ProductSpecification, CrudContext>({
    uc: loadUCFactory<ProductSpecification>(),
    ctx,
  });

  const pick = (item: ProductSpecification) => {
    wizard.setStepValue('source', {
      kind: 'selection',
      ids: [String(item.id)],
    });

    const copy = cloneEntityDraft(
      ProductSpecification,
      seedEntityDraft(describeEntityColumns(ProductSpecification, item), item),
    );
    wizard.draftStoreFor('identity').save(only(copy, IDENTITY_FIELDS));
    wizard
      .draftStoreFor('classification')
      .save(only(copy, CLASSIFICATION_FIELDS));
  };

  return (
    <Stack gap="xs">
      <Text tone="muted">
        {translateKey(
          'shell:marketplaceAdmin.wizard.productSetup.source.prompt',
        )}
      </Text>
      {chosen !== undefined && (
        <Text step={-1} weight="medium">
          {translateKey(
            'shell:marketplaceAdmin.wizard.productSetup.source.chosen',
            { name: chosen },
          )}
        </Text>
      )}
      <EntityTable
        entityConstructor={ProductSpecification}
        {...pager}
        onSelect={pick}
      />
    </Stack>
  );
}

/** The members of `draft` this step owns, and no others. */
function only(draft: EntityDraft, fields: readonly string[]): EntityDraft {
  return Object.fromEntries(
    fields.filter(field => field in draft).map(field => [field, draft[field]]),
  );
}

interface FormStepProps {
  wizard: ReturnType<typeof useWizard>;
  stepId: string;
  fields: readonly string[];
  links: readonly EntityCrudLinkSource[];
  registerGate: (
    stepId: string,
    validate: (() => Promise<boolean>) | undefined,
  ) => void;
}

/**
 * One form step: its own `useEntityForm` over the members it owns.
 *
 * A component rather than a branch in the host, because React's hook count must
 * stay fixed — five form steps cannot be five conditional hook calls. It
 * unmounts when the operator moves on, and nothing is lost because its draft
 * lives in the wizard's state, which is what `draftStoreFor` hands it.
 *
 * `fields` scopes the descriptors, so the step validates **its** members and no
 * others: without it, step one could not advance until members it does not show
 * were filled.
 */
function FormStep({
  wizard,
  stepId,
  fields,
  links,
  registerGate,
}: FormStepProps) {
  const form = useEntityForm({
    entityConstructor: ProductSpecification,
    fields,
    draft: wizard.draftStoreFor(stepId),
    // The step does not submit anything. Reaching here means it validated, and
    // the wizard's own Siguiente is what acts on that.
    onSubmit: () => undefined,
  });

  // The wizard's Siguiente is this step's submit, so hand it up. Cleared on
  // unmount, or the next step would be gated by the one before it.
  const submit = form.submit;
  useEffect(() => {
    registerGate(stepId, submit);
    return () => registerGate(stepId, undefined);
  }, [registerGate, stepId, submit]);

  const linkSources = useEntityLinkSources(links, {
    values: form.values,
    selection: form.links,
  });

  const hidden = describeEntityColumns(ProductSpecification)
    .map(descriptor => descriptor.name)
    .filter(name => !fields.includes(name));

  return (
    <EntityForm<ProductSpecification>
      entityConstructor={ProductSpecification}
      embedded
      mode="edit"
      values={form.values}
      errors={form.errors}
      formError={form.formError}
      onFieldChange={form.setField}
      onLinkChange={form.setLink}
      linkSources={linkSources}
    >
      {hidden.map(name => (
        <EntityField<ProductSpecification> key={name} field={name} hidden />
      ))}
    </EntityForm>
  );
}

/** The read-only repaso, and the last thing before the write. */
function SummaryStep({
  wizard,
  links,
}: {
  wizard: ReturnType<typeof useWizard>;
  links: readonly EntityCrudLinkSource[];
}) {
  const translateKey = useTranslateKey();
  const key = (leaf: string) =>
    `shell:marketplaceAdmin.wizard.productSetup.summary.${leaf}`;

  const values: EntityDraft = {
    ...readStepDraft(wizard.state, 'identity'),
    ...readStepDraft(wizard.state, 'classification'),
  };
  const source = readStepIds(wizard.state, 'source')[0];

  /**
   * The pickers again, read-only, so the repaso says "Globex 1" and not
   * `product-brand-2`.
   *
   * The draft holds ids — they are the truth, and the picked instances are an
   * unpersisted sidecar (ADR 0032) belonging to a step that has since unmounted.
   * So the names are resolved here rather than carried: the same lookup the
   * picker itself performs, through the owning domain's own read path.
   *
   * ⚠️ Without this the summary shows foreign keys, which is exactly the check
   * the step exists to let someone make.
   */
  const sources = useEntityLinkSources(links, {
    values,
    selection: {},
  });

  return (
    <Card>
      <Stack gap="s">
        <Text tone="muted">{translateKey(key('prompt'))}</Text>
        <dl className="flex flex-col gap-2xs">
          <SummaryRow
            label={translateKey(key('origin'))}
            value={
              source === undefined
                ? translateKey(key('originBlank'))
                : translateKey(key('originDuplicate'), { name: source })
            }
          />
          {[...IDENTITY_FIELDS, ...CLASSIFICATION_FIELDS].map(field => (
            <SummaryRow
              key={field}
              label={translateKey(
                `entity:product-specification.fields.${labelLeafOf(field)}`,
              )}
              value={
                sources[field]?.selected.label ??
                readValue(values, field) ??
                translateKey(key('empty'))
              }
            />
          ))}
        </dl>
      </Stack>
    </Card>
  );
}

/**
 * The catalog leaf for a member.
 *
 * `brandId`/`categoryId` are named `brand`/`category` in the catalog, because
 * the copy names the thing rather than the foreign key holding it.
 */
function labelLeafOf(field: string): string {
  return field.endsWith('Id') ? field.slice(0, -2) : field;
}

function readValue(values: EntityDraft, field: string): string | undefined {
  const value = values[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Cluster gap="2xs" align="baseline">
      <Text as="dt" step={-1} tone="muted" className="min-w-32">
        {label}
      </Text>
      <Text as="dd" step={0}>
        {value}
      </Text>
    </Cluster>
  );
}

/** What a resumed wizard shows above the step it was left on. */
function Recap({
  state,
  links,
}: {
  state: ReturnType<typeof useWizard>['state'];
  links: readonly EntityCrudLinkSource[];
}) {
  const translateKey = useTranslateKey();
  const values: EntityDraft = {
    ...readStepDraft(state, 'identity'),
    ...readStepDraft(state, 'classification'),
  };

  // Names, not foreign keys — the same reason the summary resolves them. A
  // recap exists because a returning operator cannot remember what they chose,
  // and `product-brand-3` is not a reminder of anything.
  const sources = useEntityLinkSources(links, { values, selection: {} });
  // Paired before filtering, so the render reads the value it already has — a
  // second `readValue` there would need a fallback for a case the filter has
  // already removed.
  const answered = [...IDENTITY_FIELDS, ...CLASSIFICATION_FIELDS]
    .map(field => ({
      field: field as string,
      value: sources[field]?.selected.label ?? readValue(values, field),
    }))
    .filter(
      (entry): entry is { field: string; value: string } =>
        entry.value !== undefined,
    );

  return (
    <Stack gap="3xs">
      <Text step={-1} tone="muted">
        {translateKey('shell:marketplaceAdmin.wizard.productSetup.recap')}
      </Text>
      {answered.map(({ field, value }) => (
        <RecapLine key={field} field={field} value={value} />
      ))}
    </Stack>
  );
}

/** One decided answer, as `Label: value`. */
function RecapLine({ field, value }: { field: string; value: string }) {
  const translateKey = useTranslateKey();
  const line = `${translateKey(
    `entity:product-specification.fields.${labelLeafOf(field)}`,
  )}: ${value}`;

  return <Text step={-1}>{line}</Text>;
}
