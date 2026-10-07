import type { CatalogueEntry, Timeline } from '../score/model';

export type CatalogueItem = { entry: CatalogueEntry; timeline?: Timeline; error?: string };
type Props = {
  items: CatalogueItem[]; query: string; onQuery: (value: string) => void;
  selected?: string; onSelect: (id: string) => void; loading: boolean; error?: string;
};
export function Catalogue({ items, query, onQuery, selected, onSelect, loading, error }: Props) {
  const filtered = items.filter(({ entry, timeline }) => `${timeline?.score.title || entry.id} ${timeline?.score.composer || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="catalogue" aria-label="Score catalogue">
    <div className="catalogue-heading"><h2>Your scores</h2><span>{items.length}</span></div>
    <label className="search-label" htmlFor="score-search">Search scores</label>
    <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
      <input id="score-search" type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Find a piece…" />
    </div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && !items.length ? <p role="status">Loading your scores…</p> : null}
    {!loading && !error && !items.length ? <p>Add a MuseScore file to /scores and rebuild to begin.</p> : null}
    {items.length && !filtered.length ? <p>No scores match “{query}”.</p> : null}
    <div className="score-list">
      {filtered.map(({ entry, timeline, error: scoreError }) => <div key={entry.id}>
        <button className={`score-choice ${selected === entry.id ? 'selected' : ''}`} onClick={() => onSelect(entry.id)} disabled={!timeline} aria-pressed={selected === entry.id}>
          <span className="score-icon" aria-hidden="true">♫</span>
          <span><strong>{timeline?.score.title || entry.id.replace(/[-_]/g, ' ')}</strong>
            <small>{scoreError ? 'Could not load' : timeline ? `${timeline.score.writtenMeasureCount || timeline.score.measures.length} bars · ${timeline.score.parts.length} parts` : 'Reading score…'}</small></span>
          {selected === entry.id ? <span className="selected-dot" aria-hidden="true" /> : null}
        </button>
        {scoreError ? <p className="score-error" role="alert">{entry.filename}: {scoreError}</p> : null}
      </div>)}
    </div>
  </aside>;
}
