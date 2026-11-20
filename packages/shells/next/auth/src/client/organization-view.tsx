'use client';

import {
  Alert,
  Card,
  HeadingOne,
  HeadingTwo,
  Lead,
  Overline,
  Stack,
  Text,
  useT,
} from '@entifix/react-controls';
import {
  Checkbox,
  Select,
  SubmitButton,
  TextInput,
} from '@entifix/react-controls/primitives';
import { TaxRegimes } from '@r10c/business-ts-tax-policy';
import { useActionState } from 'react';

import {
  type OrganizationFormState,
  saveFiscalIdentity,
  savePaymentLinkAcceptance,
  saveWhatsappNumber,
} from '../server/organization-actions';
import type { FiscalIdentityValues } from '../server/organization-page';

const IDLE: OrganizationFormState = { status: 'idle' };

const TEXT_FIELDS = ['taxId', 'legalName', 'establishmentCode'] as const;

/**
 * The organization's fiscal identity, as a form its `admin` saves
 * (`set-fiscal-identity`). `undefined` is a read that failed — no permission,
 * or auth-service unreachable — and says so rather than offering an empty
 * form that would overwrite what is stored.
 */
export function OrganizationView({
  fiscal,
  paymentLink,
  whatsapp,
}: {
  readonly fiscal: FiscalIdentityValues | null | undefined;
  /** Whether it takes payment links; `undefined` is a read that failed. */
  readonly paymentLink: boolean | undefined;
  /** The WhatsApp number, `''` for none; `undefined` is a read that failed. */
  readonly whatsapp: string | undefined;
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
        <PaymentLinkCard accepts={paymentLink} />
        <WhatsappCard number={whatsapp} />
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
      <PaymentLinkCard accepts={paymentLink} />
      <WhatsappCard number={whatsapp} />
    </Stack>
  );
}

/**
 * Whether the organization takes payment by a link it sends the buyer
 * (`set-payment-link-acceptance`, ADR 0081 §1). Its own form, so saving one
 * statement never re-posts the other; a failed read says so rather than
 * offering an unticked box that would switch links off.
 */
function PaymentLinkCard({
  accepts,
}: {
  readonly accepts: boolean | undefined;
}) {
  const t = useT('r10c');
  const tEntity = useT('entity');
  const tErrors = useT('errors');
  const [state, action] = useActionState(savePaymentLinkAcceptance, IDLE);

  return (
    <Card>
      <Stack gap="s">
        <HeadingTwo>{t('auth.organization.paymentLink.title')}</HeadingTwo>
        {accepts === undefined ? (
          <Text muted>{t('auth.organization.paymentLink.failed')}</Text>
        ) : (
          <form action={action} data-testid="payment-link-acceptance-form">
            <Stack gap="s">
              <Text muted>{t('auth.organization.paymentLink.hint')}</Text>
              <Checkbox
                name="accepts"
                defaultChecked={accepts}
                label={t('auth.organization.paymentLink.accepts')}
              />
              {state.status === 'saved' ? (
                <Alert tone="success">
                  {t('auth.organization.paymentLink.saved')}
                </Alert>
              ) : null}
              {state.status === 'refused' ? (
                <Alert tone="danger">
                  {tErrors(state.code ?? 'unexpected')}
                </Alert>
              ) : null}
              <SubmitButton className="touch-target">
                {tEntity('organization.useCases.setPaymentLinkAcceptance')}
              </SubmitButton>
            </Stack>
          </form>
        )}
      </Stack>
    </Card>
  );
}

/**
 * The WhatsApp number buyers may write to (`set-whatsapp-number`, #671): every
 * receipt with this seller on it links to a chat with it. Its own form, as the
 * other statements are; a failed read says so rather than offering an empty
 * field that would withdraw the number.
 */
function WhatsappCard({ number }: { readonly number: string | undefined }) {
  const t = useT('r10c');
  const tEntity = useT('entity');
  const tErrors = useT('errors');
  const [state, action] = useActionState(saveWhatsappNumber, IDLE);

  return (
    <Card>
      <Stack gap="s">
        <HeadingTwo>{t('auth.organization.whatsapp.title')}</HeadingTwo>
        {number === undefined ? (
          <Text muted>{t('auth.organization.whatsapp.failed')}</Text>
        ) : (
          <form action={action} data-testid="whatsapp-number-form">
            <Stack gap="s">
              <Text muted>{t('auth.organization.whatsapp.hint')}</Text>
              <div className="flex min-w-0 flex-col gap-3xs">
                <label
                  htmlFor="organization-whatsapp"
                  className="text-step--1 font-semibold"
                >
                  {tEntity('organization.fields.whatsappNumber')}
                </label>
                <TextInput
                  id="organization-whatsapp"
                  name="number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="w-full min-w-0"
                  defaultValue={number}
                  aria-invalid={state.status === 'refused' ? true : undefined}
                />
              </div>
              {state.status === 'saved' ? (
                <Alert tone="success">
                  {t('auth.organization.whatsapp.saved')}
                </Alert>
              ) : null}
              {state.status === 'refused' ? (
                <Alert tone="danger">
                  {tErrors(state.code ?? 'unexpected')}
                </Alert>
              ) : null}
              <SubmitButton className="touch-target">
                {tEntity('organization.useCases.setWhatsappNumber')}
              </SubmitButton>
            </Stack>
          </form>
        )}
      </Stack>
    </Card>
  );
}
