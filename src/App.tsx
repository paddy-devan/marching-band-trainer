import { useEffect, useState } from 'react';
import { loadCatalogue, loadScore } from './score/loader';
import { Catalogue, type CatalogueItem } from './ui/Catalogue';
import { Practice } from './ui/Practice';

export default function App() {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
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
            setSelected(current => current || entry.id);
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
  const timeline = items.find(item => item.entry.id === selected)?.timeline;
  return <>
    <header className="app-header"><a href={import.meta.env.BASE_URL} className="brand" aria-label="SLSCC Band home"><span className="brand-mark" aria-hidden="true" /><span>SLSCC <strong>Band</strong></span></a></header>
    <div className="app-layout"><Catalogue items={items} selected={selected} onSelect={setSelected} query={query} onQuery={setQuery} loading={loading} error={error} />
      {timeline ? <Practice key={timeline.score.id} timeline={timeline} /> : <main className="empty-state"><h1>{loading ? 'Loading scores…' : 'Select a score'}</h1></main>}
    </div>
  </>;
}
