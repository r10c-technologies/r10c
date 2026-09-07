'use client';

import { useEffect, useRef } from 'react';

/** One chord, described the way a person would say it. */
export interface Hotkey {
  /** The `KeyboardEvent.key`, compared case-insensitively. */
  readonly key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. Either satisfies it. */
  readonly mod?: boolean;
  readonly shift?: boolean;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // `closest`, not `isContentEditable`: the property is true for a *descendant*
  // of an editable host but is not implemented in jsdom, so the branch that
  // matters most for a rich editor would be the one no test could reach. The
  // selector covers the host and everything inside it, and the `:not` arm is
  // what keeps `contenteditable="false"` — the way a widget opts a subtree back
  // out — from reading as editable.
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
};

const matches = (event: KeyboardEvent, hotkey: Hotkey): boolean => {
  if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) return false;
  // ⌘ and Ctrl are the same intent on different platforms, so either satisfies
  // `mod` rather than the hook asking the caller to sniff the platform. Nothing
  // in the fleet binds a chord that means one thing with ⌘ and another with Ctrl.
  const mod = event.metaKey || event.ctrlKey;
  if ((hotkey.mod ?? false) !== mod) return false;
  return (hotkey.shift ?? false) === event.shiftKey;
};

/**
 * Fire `handler` when any of `hotkeys` is pressed, anywhere on the page.
 *
 * The repo's first global shortcut, so two things are decided here rather than
 * at each future call site.
 *
 * **It skips while focus is in an editable element**, because a page-wide
 * listener that does not would eat the chord a person meant for the field they
 * are typing in. The palette's own input is exempt in practice: the palette
 * unmounts its trigger's listener behaviour by simply not being open.
 *
 * **It calls `preventDefault`**, which is what stops the browser acting on a
 * chord it also claims. ⚠️ That is not guaranteed to work: Chrome, Safari and
 * Edge dispatch these to the page and honour it, Firefox reserves some chords
 * and ignores `defaultPrevented` for them. So no single binding may be
 * load-bearing — bind more than one, and always leave a visible control that
 * does the same thing.
 *
 * `handler` is held in a ref so a caller may pass an inline closure without
 * re-subscribing the listener on every render.
 */
export function useHotkey(
  hotkeys: readonly Hotkey[],
  handler: (event: KeyboardEvent) => void,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  // Serialized rather than passed by identity: callers build the array inline,
  // so the array itself is a new object every render and would re-subscribe the
  // listener on each one.
  const signature = JSON.stringify(hotkeys);

  useEffect(() => {
    const bindings = JSON.parse(signature) as Hotkey[];

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      if (!bindings.some(hotkey => matches(event, hotkey))) return;
      event.preventDefault();
      handlerRef.current(event);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [signature]);
}
