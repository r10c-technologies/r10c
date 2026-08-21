'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';

import { useT } from '../../../i18n';
import { Button } from '../../atoms/button';

export type ConfirmTone = 'destructive' | 'neutral';

export interface ConfirmDialogProps {
  open: boolean;
  /** Already-resolved copy — this control renders text, it does not translate. */
  title: string;
  message: string;
  /** `destructive` paints the confirm button in the danger tokens. */
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an irreversible act.
 *
 * It exists because a use-case descriptor may carry
 * `confirm: { tone, messageKey }`, and a surface that renders such a descriptor
 * without asking would fire the act on the first click — `revoke-sessions` ends
 * every session a user holds. The descriptor names the tone and the message key;
 * resolving that key is the caller's job, so this control stays copy-free apart
 * from its own two buttons.
 *
 * The dialog element fills the viewport rather than wrapping a `fixed` child in
 * a `relative` box, for the reason `EntityLinkPicker` records: a zero-sized
 * dialog is invisible to anything that measures it — assistive tech and
 * Playwright alike — even with a painted panel inside.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  tone = 'neutral',
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-s"
    >
      <div aria-hidden className="fixed inset-0 bg-black/40" />
      <DialogPanel
        data-testid="confirm-dialog"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface p-s shadow-lg"
      >
        <DialogTitle className="text-step-1 font-semibold text-content">
          {title}
        </DialogTitle>
        <p className="mt-2xs text-step-sm text-content-muted">{message}</p>
        <div className="mt-s flex justify-end gap-xs">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel ?? t('confirm.cancel')}
          </Button>
          <Button
            type="button"
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel ?? t('confirm.confirm')}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
