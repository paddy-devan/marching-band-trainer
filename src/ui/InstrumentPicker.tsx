import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Part } from '../score/model';

type Props = { parts: Part[]; selected: string; onChange: (id: string) => void };

// Render choices inside the page so selecting a part never waits for a native
// menu to finish dismissing before delivering its change event.
export const InstrumentPicker = memo(function InstrumentPicker({ parts, selected, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: '', time: 0 });
  const selectedIndex = parts.findIndex(part => part.id === selected);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  const choose = (index: number, pointer = false) => {
    onChange(parts[index].id);
    setOpen(false);
    search.current.text = '';
    if (pointer) trigger.current?.blur();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key === 'Tab') {
      if (open) choose(active);
      return;
    }
    if (key === 'Escape') {
      setOpen(false);
      search.current.text = '';
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (event.repeat) return;
      if (open) choose(active);
      else { setActive(selectedIndex); setOpen(true); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) {
      event.preventDefault();
      search.current.text = '';
      if (open && event.altKey && key === 'ArrowUp') { choose(active); return; }
      const current = open ? active : selectedIndex;
      const next = key === 'Home' ? 0 : key === 'End' ? parts.length - 1
        : key === 'PageDown' ? current + 10 : key === 'PageUp' ? current - 10
        : open ? current + (key === 'ArrowDown' ? 1 : -1) : current;
      setActive(Math.max(0, Math.min(parts.length - 1, next)));
      setOpen(true);
      return;
    }
    if (key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const now = performance.now();
    const text = (now - search.current.time < 700 ? search.current.text : '') + key.toLocaleLowerCase();
    search.current = { text, time: now };
    const repeated = [...text].every(character => character === text[0]);
    const prefix = repeated ? text[0] : text;
    const start = (open ? active : selectedIndex) + (repeated ? 1 : 0);
    const match = Array.from({ length: parts.length }, (_, i) => (start + i) % parts.length)
      .find(index => parts[index].name.toLocaleLowerCase().startsWith(prefix));
    setActive(match ?? (open ? active : selectedIndex));
    setOpen(true);
  };

  return <div className="instrument-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" id="visual-part" ref={trigger} className="instrument-trigger"
      role="combobox" aria-label="Visualised instrument" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={`${id}-listbox`}
      aria-activedescendant={open ? optionId(active) : undefined}
      onKeyDown={keyDown} onClick={() => {
        setActive(selectedIndex);
        search.current.text = '';
        setOpen(!open);
      }}>
      {parts[selectedIndex].name}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {open ? <ul id={`${id}-listbox`} className="instrument-options" role="listbox" aria-label="Visualised instrument">
      {parts.map((part, index) => <li id={optionId(index)} key={part.id} role="option"
        aria-selected={index === active} className="instrument-option"
        onPointerDown={event => event.preventDefault()} onClick={event => choose(index, event.detail > 0)}>
        <span>{part.name}</span>
        {part.id === selected ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> : null}
      </li>)}
    </ul> : null}
  </div>;
});
