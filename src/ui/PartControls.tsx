import type { Mix } from '../audio/transport';
import type { Part } from '../score/model';

type Props = { parts: Part[]; selected: string; onSelect: (id: string) => void; mix: Mix; onMix: (mix: Mix) => void };
export function PartControls({ parts, selected, onSelect, mix, onMix }: Props) {
  const toggle = (id: string, field: 'muted' | 'solo') => onMix({ ...mix, [id]: { ...mix[id], [field]: !mix[id]?.[field] } });
  return <section className="part-controls" aria-labelledby="parts-title">
    <div className="section-heading"><h2 id="parts-title">Make it your practice</h2><p>Choose what you hear and what you see.</p></div>
    <div className="part-table">
      <div className="part-table-head"><span>Part</span><span>Listen</span><span>Follow</span></div>
      {parts.map(part => <div className="part-row" key={part.id}>
        <div><strong>{part.name}</strong><small>{part.percussion ? 'Percussion' : 'Melody'}</small></div>
        <div className="mix-buttons">
          <button aria-label={`Mute ${part.name}`} aria-pressed={!!mix[part.id]?.muted} className={mix[part.id]?.muted ? 'is-muted' : ''} onClick={() => toggle(part.id, 'muted')}>{mix[part.id]?.muted ? 'Muted' : 'Mute'}</button>
          <button aria-label={`Solo ${part.name}`} aria-pressed={!!mix[part.id]?.solo} className={mix[part.id]?.solo ? 'is-solo' : ''} onClick={() => toggle(part.id, 'solo')}>Solo</button>
        </div>
        <button className={`follow-button ${selected === part.id ? 'chosen' : ''}`} aria-label={`Visualise ${part.name}`} aria-pressed={selected === part.id} onClick={() => onSelect(part.id)}>{selected === part.id ? 'Following' : 'Follow'}</button>
      </div>)}
    </div>
  </section>;
}
