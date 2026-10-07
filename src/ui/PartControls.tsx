import type { Mix } from '../audio/transport';
import type { Part } from '../score/model';

type Props = { parts: Part[]; selected: string; onSelect: (id: string) => void; mix: Mix; onMix: (mix: Mix) => void };
export function PartControls({ parts, selected, onSelect, mix, onMix }: Props) {
  const toggle = (id: string, field: 'muted' | 'solo') => onMix({ ...mix, [id]: { ...mix[id], [field]: !mix[id]?.[field] } });
  return <section className="part-controls" aria-label="Parts">
    <div className="part-table">
      <h2 className="parts-heading">Parts</h2>
      {parts.map(part => <div className="part-row" key={part.id}>
        <strong>{part.name}</strong>
        <div className="part-actions">
          <button aria-label={`Mute ${part.name}`} title={`Mute ${part.name}`} aria-pressed={!!mix[part.id]?.muted} className={`icon-button ${mix[part.id]?.muted ? 'is-muted' : ''}`} onClick={() => toggle(part.id, 'muted')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" />{mix[part.id]?.muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</svg>
          </button>
          <button aria-label={`Solo ${part.name}`} title={`Solo ${part.name}`} aria-pressed={!!mix[part.id]?.solo} className={`icon-button ${mix[part.id]?.solo ? 'is-solo' : ''}`} onClick={() => toggle(part.id, 'solo')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></svg>
          </button>
          <button className={`icon-button follow-button ${selected === part.id ? 'chosen' : ''}`} aria-label={`Visualise ${part.name}`} title={`Visualise ${part.name}`} aria-pressed={selected === part.id} onClick={() => onSelect(part.id)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
        </div>
      </div>)}
    </div>
  </section>;
}
