'use client';

import {
  assertWizardDefinition,
  readStepChoice,
  readStepDraft,
  type WizardDefinition,
} from '@entifix/core';
import {
  useFollowWizardStepUrl,
  useLocaleHref,
  useWizardDraft,
  useWizardStepUrl,
} from '@entifix/next-shell';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Stack,
  Text,
  useLocale,
  useTranslateKey,
  Wizard,
} from '@entifix/react-controls';
import { TextInput } from '@entifix/react-controls/primitives';
import { useWizard } from '@entifix/react-integration';
import {
  type CatalogImportMode,
  IMPORT_HEADERS,
  type ImportColumn,
  type ImportProblem,
  type ImportRow,
  importTemplateCsv,
  readImportSheet,
  toImportRows,
} from '@r10c/business-ts-product-configuration-management';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { CATALOG_IMPORT_LIST_SURFACE } from '../catalog-surfaces';
import { CATALOG_IMPORT_SURFACE, wizardAddress } from '../wizard-surfaces';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/** What every sheet's price is in when its row names no currency. */
const DEFAULT_CURRENCY = 'GTQ';

const copy = (leaf: string) =>
  `r10c:marketplaceAdmin.wizard.catalogImport.${leaf}`;

/**
 * Load a catalog from a sheet (ADR 0084): how the products should be left,
 * which sheet, and a review of what will and will not be imported. It ends
 * in one `import` verb carrying every row — never a save per product.
 *
 * **The sheet is parsed here and never uploaded.** What the wizard keeps in
 * its draft is the rows it read (JSON, ADR 0032) and the import's key, so a
 * refreshed tab resumes the review and a resubmit after a lost answer resumes
 * the import rather than doubling it.
 */
export const CATALOG_IMPORT_WIZARD: WizardDefinition = {
  key: CATALOG_IMPORT_SURFACE.key,
  steps: [
    {
      id: 'mode',
      kind: 'choice',
      labelKey: copy('steps.mode'),
      options: ['draft', 'publish'],
      to: ['file'],
    },
    {
      id: 'file',
      kind: 'form',
      labelKey: copy('steps.file'),
      to: ['preview'],
    },
    {
      id: 'preview',
      kind: 'summary',
      labelKey: copy('steps.preview'),
      to: [],
    },
  ],
};

assertWizardDefinition(CATALOG_IMPORT_WIZARD);

const STEP_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  CATALOG_IMPORT_WIZARD.steps.map(step => [step.id, step.labelKey]),
);

/** What the file step keeps: the rows read, their problems, and the key. */
interface ReadSheet {
  readonly fileName: string;
  readonly key: string;
  readonly rows: readonly ImportRow[];
  readonly problems: readonly ImportProblem[];
}

/** Before a sheet was read: no file, no rows. */
const NO_SHEET: ReadSheet = { fileName: '', key: '', rows: [], problems: [] };

/** The file step's answer, or {@link NO_SHEET} before a sheet was read. */
export const readSheetOf = (
  values: Readonly<Record<string, unknown>>,
): ReadSheet =>
  typeof values['fileName'] === 'string' && typeof values['key'] === 'string'
    ? (values as unknown as ReadSheet)
    : NO_SHEET;

/** A sheet that can be imported: no problem with the sheet as a whole, and a row. */
export const isImportable = (sheet: ReadSheet): boolean =>
  sheet.rows.length > 0 &&
  sheet.problems.every(problem => problem.rowNumber > 1);

/** A problem's column as the sheet's header names it; nothing for the sheet. */
export const columnLabel = (
  headers: Readonly<Record<ImportColumn, string>>,
  column: ImportColumn | undefined,
): string => (column === undefined ? '' : headers[column]);

/** The locale a sheet's headers and template are written in. */
export const sheetLocaleOf = (locale: string): 'es' | 'en' =>
  locale === 'en' ? 'en' : 'es';

export interface CatalogImportWizardProps {
  /** A step the host opened at — a workspace tab's third address segment. */
  readonly step?: string;
  /** Where to go once the import answered; the route goes to its record. */
  readonly onFinished?: (result: { readonly id: string }) => void;
}

export function CatalogImportWizard({
  step,
  onFinished,
}: CatalogImportWizardProps = {}) {
  const translateKey = useTranslateKey();
  const adapters = useMarketplaceAdminAdapters();
  const router = useRouter();
  const withLocale = useLocaleHref();

  const draft = useWizardDraft(wizardAddress(CATALOG_IMPORT_SURFACE));
  const writeStep = useWizardStepUrl();
  const wizard = useWizard({
    definition: CATALOG_IMPORT_WIZARD,
    draft,
    onStepChange: writeStep,
  });
  useFollowWizardStepUrl({
    activeStep: wizard.activeStep,
    entryStep: CATALOG_IMPORT_WIZARD.steps[0].id,
    goTo: wizard.goTo,
  });

  const opened = useRef(false);
  const goTo = wizard.goTo;
  useEffect(() => {
    if (opened.current || step === undefined) return;
    opened.current = true;
    goTo(step);
  }, [step, goTo]);

  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);

  const mode = (readStepChoice(wizard.state, 'mode') ??
    'draft') as CatalogImportMode;
  const sheet = readSheetOf(readStepDraft(wizard.state, 'file'));

  const advance = () => {
    if (wizard.activeStep === 'file' && !isImportable(sheet)) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    wizard.next();
  };

  const finish = async () => {
    setSubmitting(true);
    setFailure(undefined);
    const outcome = await adapters.catalogImport.submit(sheet.key, {
      fileName: sheet.fileName,
      mode,
      rows: sheet.rows,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setFailure(outcome.code);
      return;
    }
    // Answered means committed: every row its own unit, the record last.
    draft.clear();
    if (onFinished !== undefined) {
      onFinished({ id: outcome.id });
      return;
    }
    router.push(
      withLocale(`${CATALOG_IMPORT_LIST_SURFACE.basePath}/${outcome.id}`),
    );
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
      isSubmitting={submitting}
      onNext={advance}
      onFinish={() => void finish()}
      onPrevious={
        wizard.state.history.length > 0 ? () => wizard.previous() : undefined
      }
      onStepChange={stepId => wizard.goTo(stepId)}
    >
      {wizard.activeStep === 'mode' ? (
        <ModeStep
          chosen={mode}
          choose={option =>
            wizard.setStepValue('mode', { kind: 'choice', option })
          }
        />
      ) : wizard.activeStep === 'file' ? (
        <FileStep
          sheet={sheet}
          blocked={blocked}
          keep={read => {
            setBlocked(false);
            wizard.setStepValue('file', {
              kind: 'form',
              values: read as unknown as Record<string, never>,
            });
          }}
        />
      ) : (
        <PreviewStep sheet={sheet} mode={mode} failure={failure} />
      )}
    </Wizard>
  );
}

function ModeStep({
  chosen,
  choose,
}: {
  readonly chosen: CatalogImportMode;
  readonly choose: (option: CatalogImportMode) => void;
}) {
  const translateKey = useTranslateKey();
  return (
    <Card>
      <Stack gap="s">
        <Text weight="medium">{translateKey(copy('mode.question'))}</Text>
        <Cluster gap="xs" align="stretch">
          {(['draft', 'publish'] as const).map(option => (
            <Button
              key={option}
              type="button"
              variant={chosen === option ? 'primary' : 'secondary'}
              aria-pressed={chosen === option}
              onClick={() => choose(option)}
            >
              <Stack gap="3xs" align="start" className="text-left">
                <span>{translateKey(copy(`mode.${option}`))}</span>
                <span className="text-step-xs">
                  {translateKey(copy(`mode.${option}Hint`))}
                </span>
              </Stack>
            </Button>
          ))}
        </Cluster>
      </Stack>
    </Card>
  );
}

function FileStep({
  sheet,
  blocked,
  keep,
}: {
  readonly sheet: ReadSheet;
  readonly blocked: boolean;
  readonly keep: (sheet: ReadSheet) => void;
}) {
  const translateKey = useTranslateKey();
  const locale = useLocale();
  const adapters = useMarketplaceAdminAdapters();
  const [reading, setReading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const templateLocale = sheetLocaleOf(locale);
  const headers = IMPORT_HEADERS[templateLocale];
  // What keeps the sheet as a whole from being read: a header the template
  // does not have, a required column missing, or no rows at all.
  const sheetProblems = sheet.problems.filter(
    problem => problem.rowNumber === 1,
  );

  const read = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setReading(true);
    setUnreadable(false);
    try {
      const [table, references] = await Promise.all([
        adapters.catalogImport.readTable(file),
        adapters.catalogImport.references(),
      ]);
      const parsed = readImportSheet(table);
      const { rows, problems } = toImportRows(parsed.rows, references, {
        locale,
        defaultCurrency: DEFAULT_CURRENCY,
      });
      keep({
        fileName: file.name,
        // A new sheet is a new import: a fresh key, so it never replays the
        // answer an earlier sheet got.
        key: globalThis.crypto.randomUUID(),
        rows,
        problems: [...parsed.problems, ...problems],
      });
    } catch {
      setUnreadable(true);
    } finally {
      setReading(false);
    }
  };

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(
    importTemplateCsv(templateLocale),
  )}`;

  return (
    <Card>
      <Stack gap="s">
        <Text>{translateKey(copy('file.prompt'))}</Text>
        <Cluster gap="xs">
          <ButtonLink
            variant="secondary"
            size="sm"
            href={template}
            download={`catalog-template-${templateLocale}.csv`}
          >
            {translateKey(copy('file.template'))}
          </ButtonLink>
        </Cluster>
        <Stack gap="2xs">
          <label
            htmlFor="catalog-import-file"
            className="text-step--1 font-semibold"
          >
            {translateKey(copy('file.label'))}
          </label>
          <TextInput
            id="catalog-import-file"
            name="sheet"
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="w-full min-w-0"
            onChange={event => void read(event)}
          />
        </Stack>
        <div aria-live="polite">
          {reading ? <Text>{translateKey(copy('file.reading'))}</Text> : null}
          {sheet.fileName !== '' && !reading ? (
            <Text data-testid="catalog-import-read">
              {translateKey(copy('file.read'), {
                file: sheet.fileName,
                ready: sheet.rows.length,
                rejected: sheet.problems.length,
              })}
            </Text>
          ) : null}
        </div>
        {unreadable ? (
          <Alert tone="danger">{translateKey(copy('file.unreadable'))}</Alert>
        ) : null}
        {sheetProblems.length > 0 ? (
          <Alert tone="danger" data-testid="catalog-import-sheet-problems">
            <ul>
              {sheetProblems.map(problem => (
                <li key={`${problem.code}-${String(problem.column)}`}>
                  {translateKey(`errors:${problem.code}`)}{' '}
                  {columnLabel(headers, problem.column)}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {blocked ? (
          <Alert tone="warning">{translateKey(copy('file.required'))}</Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

function PreviewStep({
  sheet,
  mode,
  failure,
}: {
  readonly sheet: ReadSheet;
  readonly mode: CatalogImportMode;
  readonly failure: string | undefined;
}) {
  const translateKey = useTranslateKey();
  const locale = useLocale();
  const headers = IMPORT_HEADERS[sheetLocaleOf(locale)];
  // The sheet's own problems kept it on the file step; these are its rows'.
  const { problems } = sheet;
  // Which of these update a product the browser cannot know: the service
  // decides by the catalog it holds. It can say how many may.
  const coded = sheet.rows.filter(row => row.sku !== undefined).length;

  return (
    <Card>
      <Stack gap="s">
        <Text>{translateKey(copy('preview.prompt'))}</Text>
        <Text data-testid="catalog-import-mode">
          {translateKey(copy('preview.mode'), {
            mode: translateKey(`entity:catalog-import.values.mode.${mode}`),
          })}
        </Text>
        <Text weight="medium" data-testid="catalog-import-ready">
          {translateKey(copy('preview.ready'), {
            count: sheet.rows.length,
          })}
        </Text>
        {coded > 0 ? (
          <Text data-testid="catalog-import-coded">
            {translateKey(copy('preview.coded'), { count: coded })}
          </Text>
        ) : null}
        {problems.length > 0 ? (
          <Stack gap="2xs">
            <Text weight="medium" data-testid="catalog-import-rejected">
              {translateKey(copy('preview.rejected'), {
                count: problems.length,
              })}
            </Text>
            <div className="overflow-x-auto">
              <table className="text-step--1 w-full">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      {translateKey(copy('preview.row'))}
                    </th>
                    <th scope="col" className="text-left">
                      {translateKey(copy('preview.column'))}
                    </th>
                    <th scope="col" className="text-left">
                      {translateKey(copy('preview.reason'))}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map(problem => (
                    <tr
                      key={`${String(problem.rowNumber)}-${problem.code}-${String(problem.column)}`}
                    >
                      <td>{problem.rowNumber}</td>
                      <td>{columnLabel(headers, problem.column)}</td>
                      <td>{translateKey(`errors:${problem.code}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Stack>
        ) : null}
        {failure === undefined ? null : (
          <Alert tone="danger" data-testid="catalog-import-failed">
            {translateKey(copy('preview.failed'))}{' '}
            {translateKey(`errors:${failure}`)}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
