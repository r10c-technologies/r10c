import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type Hotkey, useHotkey } from './use-hotkey.js';

function Harness({
  hotkeys,
  onFire,
}: {
  hotkeys: Hotkey[];
  onFire: (event: KeyboardEvent) => void;
}) {
  useHotkey(hotkeys, onFire);
  return (
    <div>
      <input aria-label="term" />
      <textarea aria-label="notes" />
      <select aria-label="choice" />
      <div contentEditable aria-label="rich" suppressContentEditableWarning>
        <span data-testid="inside-rich" />
      </div>
      <div
        contentEditable="false"
        aria-label="frozen"
        suppressContentEditableWarning
      >
        <span data-testid="inside-frozen" />
      </div>
      <span data-testid="inert" tabIndex={-1} />
    </div>
  );
}

const press = (init: KeyboardEventInit & { target?: Element }) => {
  const { target, ...rest } = init;
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

describe('useHotkey', () => {
  it('fires on the declared chord', () => {
    const onFire = vi.fn();
    render(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />);

    press({ key: 'k', metaKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('accepts Ctrl and ⌘ as the same intent, so neither platform is special', () => {
    const onFire = vi.fn();
    render(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />);

    press({ key: 'k', ctrlKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive about the key', () => {
    const onFire = vi.fn();
    render(
      <Harness
        hotkeys={[{ key: 'p', mod: true, shift: true }]}
        onFire={onFire}
      />,
    );

    press({ key: 'P', metaKey: true, shiftKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires on any of several bindings, so no single one is load-bearing', () => {
    const onFire = vi.fn();
    render(
      <Harness
        hotkeys={[
          { key: 'k', mod: true },
          { key: 'p', mod: true, shift: true },
        ]}
        onFire={onFire}
      />,
    );

    press({ key: 'k', metaKey: true });
    press({ key: 'p', metaKey: true, shiftKey: true });

    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it('ignores the plain key, the wrong modifier and an extra Shift', () => {
    const onFire = vi.fn();
    render(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />);

    press({ key: 'k' });
    press({ key: 'j', metaKey: true });
    press({ key: 'k', metaKey: true, shiftKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });

  it('supports a bare key, with no modifier declared', () => {
    const onFire = vi.fn();
    render(<Harness hotkeys={[{ key: '/' }]} onFire={onFire} />);

    press({ key: '/' });
    press({ key: '/', metaKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('prevents the browser from acting on a chord it also claims', () => {
    render(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={vi.fn()} />);

    expect(press({ key: 'k', metaKey: true }).defaultPrevented).toBe(true);
  });

  it.each([
    ['an input', 'term'],
    ['a textarea', 'notes'],
    ['a select', 'choice'],
    ['a contenteditable', 'rich'],
  ])('stays out of the way while focus is in %s', (_name, label) => {
    const onFire = vi.fn();
    const { getByLabelText } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />,
    );

    press({ key: 'k', metaKey: true, target: getByLabelText(label) });

    expect(onFire).not.toHaveBeenCalled();
  });

  it('stays out of the way inside a contenteditable, not only on its host', () => {
    const onFire = vi.fn();
    const { getByTestId } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />,
    );

    press({ key: 'k', metaKey: true, target: getByTestId('inside-rich') });

    expect(onFire).not.toHaveBeenCalled();
  });

  it('honours a subtree opted back out with contenteditable="false"', () => {
    const onFire = vi.fn();
    const { getByTestId } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />,
    );

    press({ key: 'k', metaKey: true, target: getByTestId('inside-frozen') });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires from a non-editable element', () => {
    const onFire = vi.fn();
    const { getByTestId } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />,
    );

    press({ key: 'k', metaKey: true, target: getByTestId('inert') });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires when the event has no element target at all', () => {
    const onFire = vi.fn();
    render(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    );

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('runs the latest handler without resubscribing on every render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={first} />,
    );

    rerender(<Harness hotkeys={[{ key: 'k', mod: true }]} onFire={second} />);
    press({ key: 'k', metaKey: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', () => {
    const onFire = vi.fn();
    const { unmount } = render(
      <Harness hotkeys={[{ key: 'k', mod: true }]} onFire={onFire} />,
    );

    unmount();
    press({ key: 'k', metaKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });
});
