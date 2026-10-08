import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Catalogue, type CatalogueItem } from '../src/ui/Catalogue';
import { interpretScore } from '../src/score/interpret';
import { fixture } from './helpers';

const items: CatalogueItem[] = ['16obr', 'colonel-bogey'].map(id => ({
  entry: { id, filename: `${id}.mscz`, url: `${id}.mscz` },
  timeline: interpretScore(fixture(id)),
}));
let container: HTMLDivElement;
let root: Root;
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  // jsdom has no native modal implementation; simulate its open/close events.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    const [selected, setSelected] = useState('16obr');
    const [query, setQuery] = useState('');
    return createElement(Catalogue, { items, selected, onSelect: setSelected, query, onQuery: setQuery, loading: false });
  }
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const [key, descriptor] of [['showModal', originalShow], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
  vi.unstubAllGlobals();
});

it('opens the picker, switches scores, closes it and restores page scrolling', () => {
  const trigger = container.querySelector<HTMLButtonElement>('.change-score')!;
  const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
  act(() => trigger.click());
  expect(dialog.open).toBe(true);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.body.style.overflow).toBe('hidden');
  expect(dialog.querySelector('.selected')?.textContent).toContain('16 Bar Off Beat');
  const choice = [...dialog.querySelectorAll<HTMLButtonElement>('.score-choice')].find(button => button.textContent?.includes('Colonel Bogey'))!;
  act(() => choice.click());
  expect(dialog.open).toBe(false);
  expect(container.querySelector('.mobile-score-switcher h1')?.textContent).toBe('Colonel Bogey');
  expect(container.querySelector('.mobile-score-switcher p')?.textContent).toBe('Kenneth J. Alford');
  expect(container.querySelector('.mobile-score-switcher')?.textContent).not.toContain('Current score');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.body.style.overflow).toBe('');
});

it('filters the picker and clears the previous search when reopened', () => {
  const trigger = container.querySelector<HTMLButtonElement>('.change-score')!;
  const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
  act(() => trigger.click());
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'colonel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(dialog.querySelectorAll('.score-choice')).toHaveLength(1);
  expect(dialog.querySelector('.score-choice')?.textContent).toContain('Colonel Bogey');
  act(() => dialog.querySelector<HTMLButtonElement>('.score-picker-close')!.click());
  act(() => trigger.click());
  expect(input.value).toBe('');
  expect(dialog.querySelectorAll('.score-choice')).toHaveLength(2);
});
