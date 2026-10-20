import { useEffect, useRef, useState } from 'react';
import type { CatalogueEntry, ScoreType, Timeline } from '../score/model';

export type CatalogueItem = { entry: CatalogueEntry; timeline?: Timeline; error?: string };
const scoreGroups: { type: ScoreType; title: string }[] = [
  { type: 'drum-solo', title: 'Drum solos' },
  { type: 'full-band', title: 'Full band pieces' },
];
function scoreType({ entry, timeline }: CatalogueItem): ScoreType {
  return entry.type ?? (timeline && timeline.score.parts.length > 0 && timeline.score.parts.every(part => part.percussion) ? 'drum-solo' : 'full-band');
}

function ScoreIcon({ type }: { type: ScoreType }) {
  return <span className="score-icon" aria-hidden="true">{type === 'drum-solo' ? <svg viewBox="0 0 24 24">
    <ellipse cx="12" cy="9" rx="9" ry="3" />
    <path d="M3 9v8c0 1.7 4 3 9 3s9-1.3 9-3V9M6 11l2 8 4-7 4 7 2-8M5 2l14 3M19 2l-5 2" />
  </svg> : '♫'}</span>;
}

type Props = {
  items: CatalogueItem[]; query: string; onQuery: (value: string) => void;
  selected?: string; onSelect: (id: string) => void; loading: boolean; error?: string; landing?: boolean;
};
export function Catalogue({ items, query, onQuery, selected, onSelect, loading, error, landing = false }: Props) {
  const picker = useRef<HTMLDialogElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = items.find(({ entry }) => entry.id === selected);
  const currentTitle = current?.timeline?.score.title || current?.entry.id.replace(/[-_]/g, ' ') || 'Choose a score';
  const currentComposer = current?.timeline?.score.composer;
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
  const filtered = items.filter(item => {
    const { entry, timeline } = item;
    const typeLabel = scoreGroups.find(group => group.type === scoreType(item))!.title;
    return `${timeline?.score.title || entry.id.replace(/[-_]/g, ' ')} ${timeline?.score.composer || ''} ${entry.description || ''} ${typeLabel}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const notices = <>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && !items.length ? <p role="status">Loading your scores…</p> : null}
    {!loading && !error && !items.length ? <p>Add a MuseScore file to /scores and rebuild to begin.</p> : null}
    {items.length && !filtered.length ? <p className="score-empty" role="status">No scores match “{query}”.</p> : null}
  </>;
  const renderChoice = (item: CatalogueItem) => {
    const { entry, timeline, error: scoreError } = item;
    const type = scoreType(item);
    return <div key={entry.id}>
      <button className={`score-choice ${selected === entry.id ? 'selected' : ''}`} data-score-type={type} onClick={() => selectScore(entry.id)} disabled={!timeline} aria-pressed={selected === entry.id}>
        <ScoreIcon type={type} />
        <span><span className="sr-only">{type === 'drum-solo' ? 'Drum solo: ' : 'Full band: '}</span><strong>{timeline?.score.title || entry.id.replace(/[-_]/g, ' ')}</strong>
          {landing && entry.description ? <span className="score-description">{entry.description}</span> : null}
          {!timeline ? <small>{scoreError ? 'Could not load' : 'Reading score…'}</small> : null}</span>
        {selected === entry.id ? <span className="score-check" aria-hidden="true">✓</span> : null}
      </button>
      {scoreError ? <p className="score-error" role="alert">{entry.filename}: {scoreError}</p> : null}
    </div>;
  };
  const choices = filtered.map(renderChoice);
  const search = <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
    <input id="score-search" type="search" aria-label="Search scores" value={query} onChange={e => onQuery(e.target.value)} placeholder="Find a piece…" />
  </div>;
  if (landing) return <main className="score-landing" aria-labelledby="landing-title">
    <div className="score-landing-heading"><h1 id="landing-title">Scores</h1><span>{items.length}</span></div>
    {search}
    {notices}
    <div className="score-groups">{scoreGroups.map(group => {
      const groupItems = filtered.filter(item => scoreType(item) === group.type);
      return groupItems.length ? <section className="score-group" key={group.type} aria-labelledby={`group-${group.type}`}>
        <div className="score-group-heading"><h2 id={`group-${group.type}`}>{group.title}</h2><span>{groupItems.length}</span></div>
        <div className="score-list">{groupItems.map(renderChoice)}</div>
      </section> : null;
    })}</div>
  </main>;
  return <>
    <aside className="catalogue" aria-label="Score catalogue">
    <div className="catalogue-heading"><h2>Scores</h2><span>{items.length}</span></div>
    {search}
    {notices}
    <div className="score-list">{choices}</div>
    </aside>
    <div className="mobile-score-switcher">
      <div><h1>{currentTitle}</h1>{currentComposer ? <p>{currentComposer}</p> : null}</div>
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
