import type { Mix } from '../audio/transport';
import type { Part } from '../score/model';
import { Slider } from './Slider';

type Props = { parts: Part[]; mix: Mix; onMix: (mix: Mix) => void };
export function PartControls({ parts, mix, onMix }: Props) {
  const toggle = (id: string, field: 'muted' | 'solo') => onMix({ ...mix, [id]: { ...mix[id], [field]: !mix[id]?.[field] } });
  return <section className="part-controls" aria-label="Audio mixer">
    <div className="part-table">
      <div className="mixer-heading"><h2 className="parts-heading">Audio mixer</h2><span aria-hidden="true">M = Mute · S = Solo</span></div>
      {parts.map(part => <div className="part-row" key={part.id}>
        <strong>{part.name}</strong>
        <div className="part-actions">
          <button aria-label={`Mute ${part.name}`} title={`Mute ${part.name}`} aria-pressed={!!mix[part.id]?.muted} className={`mix-button ${mix[part.id]?.muted ? 'is-muted' : ''}`} onClick={() => toggle(part.id, 'muted')}>M</button>
          <button aria-label={`Solo ${part.name}`} title={`Solo ${part.name}`} aria-pressed={!!mix[part.id]?.solo} className="mix-button" onClick={() => toggle(part.id, 'solo')}>S</button>
        </div>
        <div className="part-volume">
          <Slider id={`volume-${part.id}`} min={0} max={100} step="1" aria-label={`${part.name} volume`} aria-valuetext={`${Math.round((mix[part.id]?.volume ?? 1) * 100)} percent`} value={Math.round((mix[part.id]?.volume ?? 1) * 100)} onChange={e => onMix({ ...mix, [part.id]: { ...mix[part.id], volume: Number(e.target.value) / 100 } })} />
          <output htmlFor={`volume-${part.id}`}>{Math.round((mix[part.id]?.volume ?? 1) * 100)}%</output>
        </div>
      </div>)}
    </div>
  </section>;
}
