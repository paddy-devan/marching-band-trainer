import { useRef } from 'react';
import type { DrumTiming } from './drum-timing';
import type { PracticeSettings } from './practice-settings';

type Props = { practiceSettings: PracticeSettings; drumTiming: DrumTiming };

export function AppFooter({ practiceSettings, drumTiming }: Props) {
  const debug = useRef<HTMLDialogElement>(null);
  const settings = {
    practiceSettings: { ...practiceSettings, partKey: practiceSettings.partKey ?? null },
    drumTimingMs: drumTiming,
  };

  return <footer className="app-footer">
    <p>Developed by <a href="https://www.sea-cadets.org/southliverpool">South Liverpool Sea Cadets</a></p>
    <button type="button" className="debug-button" aria-label="Debug" aria-haspopup="dialog" aria-controls="settings-debug" onClick={() => debug.current?.showModal()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15l6 6" /></svg>
    </button>
    <dialog id="settings-debug" className="settings-debug" ref={debug} aria-labelledby="settings-debug-title">
      <div className="settings-debug-heading">
        <h2 id="settings-debug-title">Persistent settings</h2>
        <button type="button" className="debug-button" onClick={() => debug.current?.close()} autoFocus>Close</button>
      </div>
      <pre tabIndex={0}>{JSON.stringify(settings, null, 2)}</pre>
    </dialog>
  </footer>;
}
