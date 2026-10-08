import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { loadCatalogue, loadScore } from '../src/score/loader';
import { interpretScore } from '../src/score/interpret';
import type { CatalogueEntry, Timeline } from '../src/score/model';
import { fixture } from './helpers';

vi.mock('../src/score/loader', () => ({ loadCatalogue: vi.fn(), loadScore: vi.fn() }));
vi.mock('../src/ui/Practice', () => ({
  Practice: ({ timeline }: { timeline: Timeline }) => createElement('main', null, createElement('h1', null, timeline.score.title)),
}));

const entries: CatalogueEntry[] = ['16obr', 'colonel-bogey'].map(id => ({ id, filename: `${id}.mscz`, url: `${id}.mscz` }));
const timelines = new Map(entries.map(entry => [entry.id, interpretScore(fixture(entry.id))]));
const originalUrl = window.location.href;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState(null, '', '/');
  vi.mocked(loadCatalogue).mockResolvedValue(entries);
  vi.mocked(loadScore).mockImplementation(async entry => timelines.get(entry.id)!);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', originalUrl);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(createElement(App)));
const title = () => container.querySelector('main h1')?.textContent;
const choose = (name: string) => {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.catalogue .score-choice, .score-landing .score-choice')].find(button => button.textContent?.includes(name))!;
  act(() => button.click());
};
const travel = (direction: 'back' | 'forward') => act(async () => {
  await new Promise<void>(resolve => {
    window.addEventListener('hashchange', () => resolve(), { once: true });
    window.history[direction]();
  });
});

it('opens a direct link without showing the first score while the linked score loads', async () => {
  window.history.replaceState(null, '', '/#colonel-bogey');
  let resolveLinked!: (timeline: Timeline) => void;
  const linked = new Promise<Timeline>(resolve => { resolveLinked = resolve; });
  vi.mocked(loadScore).mockImplementation(entry => entry.id === 'colonel-bogey' ? linked : Promise.resolve(timelines.get(entry.id)!));
  await render();
  expect(title()).toBe('Loading scores…');
  expect(container.querySelector('.catalogue .selected')?.textContent).toContain('colonel bogey');
  await act(async () => resolveLinked(timelines.get('colonel-bogey')!));
  expect(title()).toBe('Colonel Bogey');
  expect(window.location.hash).toBe('#colonel-bogey');
});

it('updates the fragment and preserves the deployment path and query string', async () => {
  window.history.replaceState(null, '', '/band/?view=practice');
  await render();
  expect(title()).toBe('Scores');
  expect(container.querySelector('.score-landing')).not.toBeNull();
  expect(container.querySelector('.selected')).toBeNull();
  choose('Colonel Bogey');
  expect(title()).toBe('Colonel Bogey');
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/band/?view=practice#colonel-bogey');
  const historyLength = window.history.length;
  choose('Colonel Bogey');
  expect(window.history.length).toBe(historyLength);
});

it('restores selections with Back/Forward, including the neutral landing page', async () => {
  await render();
  choose('Colonel Bogey');
  // Wait for the native fragment event before starting another history action.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  choose('16 Bar Off Beat');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await travel('back');
  expect(title()).toBe('Colonel Bogey');
  await travel('back');
  expect(window.location.hash).toBe('');
  expect(title()).toBe('Scores');
  expect(container.querySelector('.score-landing')).not.toBeNull();
  await travel('forward');
  expect(title()).toBe('Colonel Bogey');
});

it('follows a fragment edited after the app loads', async () => {
  await render();
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('hashchange', () => resolve(), { once: true });
      window.location.hash = 'colonel-bogey';
    });
  });
  expect(title()).toBe('Colonel Bogey');
});

it.each(['missing-score', '%E0%A4%A'])('reports an unknown or malformed link (%s) and lets the user recover', async fragment => {
  window.history.replaceState(null, '', `/#${fragment}`);
  await render();
  expect(title()).toBe('Score not found');
  expect(container.querySelector('.empty-state [role="alert"]')?.textContent).toContain(fragment);
  expect(window.location.hash).toBe(`#${fragment}`);
  choose('Colonel Bogey');
  expect(title()).toBe('Colonel Bogey');
  expect(window.location.hash).toBe('#colonel-bogey');
});

it('reports a linked score that failed to load instead of silently selecting another', async () => {
  window.history.replaceState(null, '', '/#colonel-bogey');
  vi.mocked(loadScore).mockImplementation(async entry => {
    if (entry.id === 'colonel-bogey') throw new Error('Cannot open this MuseScore archive.');
    return timelines.get(entry.id)!;
  });
  await render();
  expect(title()).toBe('Cannot load score');
  expect(container.querySelector('.empty-state [role="alert"]')?.textContent).toContain('Cannot open this MuseScore archive.');
  expect(window.location.hash).toBe('#colonel-bogey');
});

it('decodes encoded score IDs', async () => {
  const entry = { ...entries[1], id: 'colonel bogey' };
  vi.mocked(loadCatalogue).mockResolvedValue([entry]);
  vi.mocked(loadScore).mockResolvedValue(timelines.get('colonel-bogey')!);
  window.history.replaceState(null, '', '/#colonel%20bogey');
  await render();
  expect(title()).toBe('Colonel Bogey');
  expect(container.querySelector('.catalogue .selected')?.textContent).toContain('Colonel Bogey');
});
