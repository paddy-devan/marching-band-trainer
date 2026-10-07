import { useEffect, useRef, useState } from 'react';
import type { CatalogueEntry, Timeline } from '../score/model';

export type CatalogueItem = { entry: CatalogueEntry; timeline?: Timeline; error?: string };
type Props = {
  items: CatalogueItem[]; query: string; onQuery: (value: string) => void;
  selected?: string; onSelect: (id: string) => void; loading: boolean; error?: string; landing?: boolean;
};
export function Catalogue({ items, query, onQuery, selected, onSelect, loading, error, landing = false }: Props) {
  const picker = useRef<HTMLDialogElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = items.find(({ entry }) => entry.id === selected);
  const currentTitle = current?.timeline?.score.title || current?.entry.id.replace(/[-_]/g, ' ') || 'Choose a score';
  useEffect(() => {
    if (landing) return;
    const mobile = window.matchMedia('(max-width: 720px)');
    const closeOnDesktop = () => { if (!mobile.matches) picker.current?.close(); };
    mobile.addEventListener('change', closeOnDesktop);
    return () => mobile.removeEventListener('change', closeOnDesktop);
  }, [landing]);
  useEffect(() => {
    if (!pickerOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [pickerOpen]);
  const openPicker = () => {
    onQuery('');
    picker.current?.showModal();
    setPickerOpen(true);
  };
  const selectScore = (id: string) => {
    onSelect(id);
    if (picker.current?.open) picker.current.close();
  };
  const filtered = items.filter(({ entry, timeline }) => `${timeline?.score.title || entry.id} ${timeline?.score.composer || ''}`.toLowerCase().includes(query.toLowerCase()));
  const notices = <>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && !items.length ? <p role="status">Loading your scores…</p> : null}
    {!loading && !error && !items.length ? <p>Add a MuseScore file to /scores and rebuild to begin.</p> : null}
    {items.length && !filtered.length ? <p className="score-empty" role="status">No scores match “{query}”.</p> : null}
  </>;
  const choices = filtered.map(({ entry, timeline, error: scoreError }) => <div key={entry.id}>
    <button className={`score-choice ${selected === entry.id ? 'selected' : ''}`} onClick={() => selectScore(entry.id)} disabled={!timeline} aria-pressed={selected === entry.id}>
      <span className="score-icon" aria-hidden="true">♫</span>
      <span><strong>{timeline?.score.title || entry.id.replace(/[-_]/g, ' ')}</strong>
        {!timeline ? <small>{scoreError ? 'Could not load' : 'Reading score…'}</small> : null}</span>
      {selected === entry.id ? <span className="score-check" aria-hidden="true">✓</span> : null}
    </button>
    {scoreError ? <p className="score-error" role="alert">{entry.filename}: {scoreError}</p> : null}
  </div>);
  const search = <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
    <input id="score-search" type="search" aria-label="Search scores" value={query} onChange={e => onQuery(e.target.value)} placeholder="Find a piece…" />
  </div>;
  if (landing) return <main className="score-landing" aria-labelledby="landing-title">
    <div className="score-landing-heading"><h1 id="landing-title">Scores</h1><span>{items.length}</span></div>
    {search}
    {notices}
    <div className="score-list">{choices}</div>
  </main>;
  return <>
    <aside className="catalogue" aria-label="Score catalogue">
    <div className="catalogue-heading"><h2>Scores</h2><span>{items.length}</span></div>
    {search}
    {notices}
    <div className="score-list">{choices}</div>
    </aside>
    <div className="mobile-score-switcher">
      <div><small>Current score</small><strong>{currentTitle}</strong></div>
      <button type="button" className="change-score" onClick={openPicker} aria-haspopup="dialog" aria-expanded={pickerOpen} aria-controls="score-picker">Change score</button>
    </div>
    <dialog id="score-picker" className="score-picker" ref={picker} aria-labelledby="score-picker-title" onClose={() => setPickerOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <div className="score-picker-top">
        <div className="score-picker-handle" aria-hidden="true" />
        <div className="score-picker-heading"><h2 id="score-picker-title">Scores <span>{items.length}</span></h2><button type="button" className="score-picker-close" aria-label="Close score picker" onClick={() => picker.current?.close()}>×</button></div>
        <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <input type="search" aria-label="Search scores" value={query} onChange={e => onQuery(e.target.value)} placeholder="Find a piece…" />
        </div>
      </div>
      <div className="score-picker-body">{notices}<div className="score-list">{choices}</div></div>
    </dialog>
  </>;
}
