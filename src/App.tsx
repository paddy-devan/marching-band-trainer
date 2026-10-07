import { useEffect, useState } from 'react';
import { loadCatalogue, loadScore } from './score/loader';
import { Catalogue, type CatalogueItem } from './ui/Catalogue';
import { Practice } from './ui/Practice';

function scoreIdFromHash() {
  const fragment = window.location.hash.slice(1);
  if (!fragment) return undefined;
  try { return decodeURIComponent(fragment); }
  catch { return fragment; }
}

export default function App() {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [linkedScore, setLinkedScore] = useState(scoreIdFromHash);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const syncSelection = () => setLinkedScore(scoreIdFromHash());
    window.addEventListener('hashchange', syncSelection);
    return () => window.removeEventListener('hashchange', syncSelection);
  }, []);
  const selectScore = (id: string) => {
    setLinkedScore(id);
    const fragment = `#${encodeURIComponent(id)}`;
    if (window.location.hash !== fragment) window.location.hash = fragment;
  };
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const entries = await loadCatalogue();
        if (cancelled) return;
        setItems(entries.map(entry => ({ entry })));
        // First piece becomes usable before parsing the rest of the catalogue.
        for (const entry of entries) {
          if (cancelled) return;
          try {
            const timeline = await loadScore(entry);
            if (cancelled) return;
            setItems(current => current.map(item => item.entry.id === entry.id ? { ...item, timeline } : item));
          } catch (error) {
            if (cancelled) return;
            setItems(current => current.map(item => item.entry.id === entry.id ? { ...item, error: error instanceof Error ? error.message : 'Cannot read score.' } : item));
          }
        }
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : 'Cannot load catalogue.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void init();
    return () => { cancelled = true; };
  }, []);
  const selected = linkedScore;
  const selectedItem = items.find(item => item.entry.id === selected);
  const timeline = selectedItem?.timeline;
  const unknownScore = linkedScore !== undefined && !loading && !error && !selectedItem;
  return <>
    <header className="app-header"><a href={import.meta.env.BASE_URL} className="brand" aria-label="SLSCC Band home"><span className="brand-mark" aria-hidden="true" /><span>SLSCC <strong>Band</strong></span></a></header>
    <div className={`app-layout${linkedScore === undefined ? ' score-landing-layout' : ''}`}>
      {linkedScore === undefined ? <Catalogue landing items={items} onSelect={selectScore} query={query} onQuery={setQuery} loading={loading} error={error} /> : <>
      <Catalogue items={items} selected={selected} onSelect={selectScore} query={query} onQuery={setQuery} loading={loading} error={error} />
      {timeline ? <Practice key={timeline.score.id} timeline={timeline} /> : <main className="empty-state">
        <h1>{unknownScore ? 'Score not found' : selectedItem?.error ? 'Cannot load score' : error ? 'Cannot load scores' : loading ? 'Loading scores…' : 'Select a score'}</h1>
        {unknownScore ? <p className="error" role="alert">No score matches “{linkedScore}”. Choose another score from the list.</p> : selectedItem?.error || error ? <p className="error" role="alert">{selectedItem?.error || error}</p> : null}
      </main>}
      </>}
    </div>
  </>;
}
