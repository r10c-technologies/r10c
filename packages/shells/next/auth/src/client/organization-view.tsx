'use client';

import {
  Alert,
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  useT,
} from '@entifix/react-controls';
import {
  Select,
  SubmitButton,
  TextInput,
} from '@entifix/react-controls/primitives';
import { TaxRegimes } from '@r10c/business-ts-tax-policy';
import { useActionState } from 'react';

import {
  type FiscalIdentityFormState,
  saveFiscalIdentity,
} from '../server/organization-actions';
import type { FiscalIdentityValues } from '../server/organization-page';

const IDLE: FiscalIdentityFormState = { status: 'idle' };

const TEXT_FIELDS = ['taxId', 'legalName', 'establishmentCode'] as const;

/**
 * The organization's fiscal identity, as a form its `admin` saves
 * (`set-fiscal-identity`). `undefined` is a read that failed — no permission,
 * or auth-service unreachable — and says so rather than offering an empty
 * form that would overwrite what is stored.
 */
export function OrganizationView({
  fiscal,
}: {
  readonly fiscal: FiscalIdentityValues | null | undefined;
}) {
  const t = useT('r10c');
  const tEntity = useT('entity');
  const tErrors = useT('errors');
  const [state, action] = useActionState(saveFiscalIdentity, IDLE);

  const header = (
    <header>
      <Stack gap="2xs">
        <Overline>{t('auth.organization.overline')}</Overline>
        <HeadingOne>{t('auth.organization.title')}</HeadingOne>
        <Lead>{t('auth.organization.subtitle')}</Lead>
      </Stack>
    </header>
  );

  if (fiscal === undefined) {
    return (
      <Stack gap="l">
        {header}
        <Card>
          <Text muted>{t('auth.organization.failed')}</Text>
        </Card>
      </Stack>
    );
  }

  const invalid = (field: string) =>
    state.status === 'refused' && state.field === field ? true : undefined;

  return (
    <Stack gap="l">
      {header}
      <Card>
        <form action={action} data-testid="fiscal-identity-form">
          <Stack gap="s">
            {TEXT_FIELDS.map(field => (
              <div key={field} className="flex min-w-0 flex-col gap-3xs">
                <label
                  htmlFor={`fiscal-${field}`}
                  className="text-step--1 font-semibold"
                >
                  {tEntity(`organization.fields.${field}`)}
                </label>
                <TextInput
                  id={`fiscal-${field}`}
                  name={field}
                  className="w-full min-w-0"
                  required
                  defaultValue={fiscal?.[field] ?? ''}
                  aria-invalid={invalid(field)}
                />
              </div>
            ))}
            <div className="flex min-w-0 flex-col gap-3xs">
              <label
                htmlFor="fiscal-taxRegime"
                className="text-step--1 font-semibold"
              >
                {tEntity('organization.fields.taxRegime')}
              </label>
              <Select
                id="fiscal-taxRegime"
                name="taxRegime"
                className="w-full min-w-0"
                defaultValue={fiscal?.taxRegime ?? 'general'}
                aria-invalid={invalid('taxRegime')}
              >
                {TaxRegimes.map(regime => (
                  <option key={regime} value={regime}>
                    {tEntity(`organization.values.taxRegime.${regime}`)}
                  </option>
                ))}
              </Select>
            </div>
            {state.status === 'saved' ? (
              <Alert tone="success">{t('auth.organization.saved')}</Alert>
            ) : null}
            {state.status === 'refused' ? (
              <Alert tone="danger">{tErrors(state.code ?? 'unexpected')}</Alert>
            ) : null}
            <SubmitButton className="touch-target">
              {tEntity('organization.useCases.setFiscalIdentity')}
            </SubmitButton>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
