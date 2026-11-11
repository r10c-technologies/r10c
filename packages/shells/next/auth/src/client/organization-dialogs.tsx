'use client';

import type { EntifixFailure } from '@entifix/core';
import {
  Alert,
  Button,
  ErrorActionsProvider,
  Stack,
  Text,
  useErrorMessage,
  useT,
} from '@entifix/react-controls';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { failedResponse } from './failed-response';

/** One organization the caller belongs to, as `GET /api/auth/memberships` lists it. */
export interface MembershipRow {
  readonly organizationId: string;
  readonly name?: string;
  readonly isDefault: boolean;
  /** The organization this session acts for. */
  readonly current: boolean;
}

/** `null` when there is no session to ask about — nothing to choose from. */
export const readMemberships = async (): Promise<MembershipRow[] | null> => {
  const res = await fetch('/api/auth/memberships', { cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw await failedResponse(res);
  return ((await res.json()) as { items: MembershipRow[] }).items;
};

type Open = 'choose' | 'grant' | undefined;

/**
 * Asks the mounted provider to open the switcher, from code that cannot hold
 * a hook — the command palette's handlers are module-scope functions. A window
 * event, because the palette and the provider share nothing else.
 */
export const CHOOSE_ORGANIZATION_EVENT = 'r10c:choose-organization';

/** The palette's handler for `switch-organization`: open the switcher. */
export const requestOrganizationChoice = async (): Promise<void> => {
  window.dispatchEvent(new Event(CHOOSE_ORGANIZATION_EVENT));
};

interface OrganizationDialogs {
  /** Opens the switcher: the organizations this person may act for. */
  readonly chooseOrganization: () => void;
  /** Opens who grants access here: what a `forbidden` can be done about. */
  readonly whoCanGrant: () => void;
}

const OrganizationDialogsContext = createContext<
  OrganizationDialogs | undefined
>(undefined);

/** The two dialogs, from anywhere under {@link OrganizationDialogsProvider}. */
export function useOrganizationDialogs(): OrganizationDialogs {
  const dialogs = useContext(OrganizationDialogsContext);
  if (dialogs === undefined) {
    throw new Error(
      'useOrganizationDialogs needs an OrganizationDialogsProvider above it.',
    );
  }
  return dialogs;
}

/**
 * A modal on the native `<dialog>`: `showModal` gives the focus trap, `Escape`
 * and the inert page behind it, and `close` hands focus back to whatever
 * opened it.
 */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT('r10c');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-lg border border-border bg-surface p-s text-content shadow-overlay backdrop:bg-scrim"
    >
      <Stack gap="s">
        <h2 id={titleId} className="text-step-1 font-semibold text-content">
          {title}
        </h2>
        {open ? children : null}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('auth.organizations.close')}
          </Button>
        </div>
      </Stack>
    </dialog>
  );
}

/** The memberships, read when a dialog opens rather than on every page. */
function useMemberships(open: boolean) {
  const [rows, setRows] = useState<MembershipRow[] | null | undefined>(
    undefined,
  );
  const [failure, setFailure] = useState<EntifixFailure | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let active = true;
    readMemberships()
      .then(next => {
        if (active) setRows(next);
      })
      .catch((error: unknown) => {
        if (active) setFailure(error as EntifixFailure);
      });
    return () => {
      active = false;
    };
  }, [open]);
  return { rows, failure };
}

/** The switcher's body: one button per organization, the current one marked. */
function ChooseOrganization({ open }: { open: boolean }) {
  const t = useT('r10c');
  const errorMessage = useErrorMessage();
  const { rows, failure } = useMemberships(open);
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<EntifixFailure | undefined>(undefined);

  const choose = async (organizationId: string) => {
    setSwitching(organizationId);
    setRefused(undefined);
    const res = await fetch('/api/auth/active-organization', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    if (!res.ok) {
      setSwitching(undefined);
      setRefused(await failedResponse(res));
      return;
    }
    // The session behind every server render changed: anything short of a
    // full navigation would keep rendering the old organization's data.
    window.location.assign(window.location.href);
  };

  if (failure !== undefined) {
    return <Alert tone="danger">{t('auth.organizations.failed')}</Alert>;
  }
  if (rows === undefined) {
    return <Text muted>{t('auth.organizations.loading')}</Text>;
  }
  if (rows === null || rows.length === 0) {
    return <Text>{t('auth.organizations.none')}</Text>;
  }
  return (
    <Stack gap="xs">
      {refused === undefined ? null : (
        <Alert tone="danger">{errorMessage(refused)}</Alert>
      )}
      <ul className="flex flex-col gap-2xs">
        {rows.map(row => {
          const name = row.name ?? t('auth.organizations.unnamed');
          return (
            <li key={row.organizationId}>
              <Button
                type="button"
                variant={row.current ? 'secondary' : 'primary'}
                className="w-full justify-between"
                disabled={row.current || switching !== undefined}
                aria-current={row.current ? 'true' : undefined}
                onClick={() => void choose(row.organizationId)}
              >
                <span>{name}</span>
                {row.current ? (
                  <span>{t('auth.organizations.current')}</span>
                ) : switching === row.organizationId ? (
                  <span>{t('auth.organizations.switching')}</span>
                ) : null}
              </Button>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}

/**
 * Who grants access, for a `forbidden`. It names the organization this session
 * acts for, because its administrators are who grant roles there (ADR 0007);
 * a session with none is told an operator does. It names no person: a member
 * who may not read the user list may not learn it from a refusal either.
 */
function WhoCanGrant({ open }: { open: boolean }) {
  const t = useT('r10c');
  const { rows, failure } = useMemberships(open);

  if (failure !== undefined) {
    return <Alert tone="danger">{t('auth.organizations.failed')}</Alert>;
  }
  if (rows === undefined) {
    return <Text muted>{t('auth.organizations.loading')}</Text>;
  }
  const current = rows?.find(row => row.current);
  return (
    <Text>
      {current === undefined
        ? t('auth.organizations.grantOperator')
        : t('auth.organizations.grantMember', {
            organization: current.name ?? t('auth.organizations.unnamed'),
          })}
    </Text>
  );
}

/**
 * The organization switcher and "who can grant", mounted once above every
 * screen, and the failures that open them registered as error actions
 * (entifix ADR 0028): a region or a toast showing `noActiveOrganization`
 * offers **Choose organization**, and one showing `forbidden` offers **Who can
 * grant me access?**. The button renders only because both the handler and the
 * catalog's `errors:<code>Action` exist.
 */
export function OrganizationDialogsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useT('r10c');
  const [open, setOpen] = useState<Open>(undefined);

  const dialogs = useMemo<OrganizationDialogs>(
    () => ({
      chooseOrganization: () => setOpen('choose'),
      whoCanGrant: () => setOpen('grant'),
    }),
    [],
  );
  const actions = useMemo(
    () => ({
      noActiveOrganization: dialogs.chooseOrganization,
      forbidden: dialogs.whoCanGrant,
    }),
    [dialogs],
  );
  const close = () => setOpen(undefined);

  useEffect(() => {
    const onRequest = () => setOpen('choose');
    window.addEventListener(CHOOSE_ORGANIZATION_EVENT, onRequest);
    return () =>
      window.removeEventListener(CHOOSE_ORGANIZATION_EVENT, onRequest);
  }, []);

  return (
    <OrganizationDialogsContext.Provider value={dialogs}>
      <ErrorActionsProvider actions={actions}>
        {children}
        <Modal
          open={open === 'choose'}
          title={t('auth.organizations.switchTitle')}
          onClose={close}
        >
          <ChooseOrganization open={open === 'choose'} />
        </Modal>
        <Modal
          open={open === 'grant'}
          title={t('auth.organizations.grantTitle')}
          onClose={close}
        >
          <WhoCanGrant open={open === 'grant'} />
        </Modal>
      </ErrorActionsProvider>
    </OrganizationDialogsContext.Provider>
  );
}

/**
 * The top bar's switcher trigger, naming the organization this session acts
 * for. It renders nothing for a caller with fewer than two organizations —
 * there is nothing to switch to — which includes every operator.
 */
export function OrganizationSwitcherButton() {
  const t = useT('r10c');
  const { chooseOrganization } = useOrganizationDialogs();
  const [rows, setRows] = useState<MembershipRow[] | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let active = true;
    readMemberships()
      .then(next => {
        if (active) setRows(next);
      })
      // The trigger is a convenience: a failed read leaves it out, and the
      // switcher itself still says why when it is opened another way.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (rows === undefined || rows === null || rows.length < 2) return null;
  const current = rows.find(row => row.current);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={chooseOrganization}
    >
      {t('auth.organizations.trigger', {
        name: current?.name ?? t('auth.organizations.unnamed'),
      })}
    </Button>
  );
}
