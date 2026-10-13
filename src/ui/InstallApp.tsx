import { useEffect, useRef, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const installedKey = 'slscc-band-installed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function rememberedInstallation() {
  try { return localStorage.getItem(installedKey) === 'true'; }
  catch { return false; }
}

function rememberInstallation(installed: boolean) {
  try {
    if (installed) localStorage.setItem(installedKey, 'true');
    else localStorage.removeItem(installedKey);
  } catch { /* Installation still works when browser storage is unavailable. */ }
}

// Keep this hook in App so browser events are retained during full-screen challenges.
export function useAppInstall() {
  const [installed, setInstalled] = useState(() => isStandalone() || rememberedInstallation());
  const [prompt, setPrompt] = useState<InstallPromptEvent>();
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const markInstalled = () => {
      rememberInstallation(true);
      setInstalled(true);
      setPrompt(undefined);
    };
    const onPrompt = (event: Event) => {
      event.preventDefault();
      // A new prompt is authoritative, including after the app was uninstalled.
      rememberInstallation(false);
      setInstalled(isStandalone());
      setPrompt(event as InstallPromptEvent);
    };
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () => { if (isStandalone()) markInstalled(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', markInstalled);
    displayMode.addEventListener('change', onDisplayMode);
    if (isStandalone()) markInstalled();
    const relatedApps = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string }>>;
    };
    if (relatedApps.getInstalledRelatedApps) {
      const manifestUrl = new URL(`${import.meta.env.BASE_URL}manifest.webmanifest`, window.location.href).href;
      void relatedApps.getInstalledRelatedApps().then(apps => {
        if (!cancelled && apps.some(app => app.platform === 'webapp' && app.url === manifestUrl)) markInstalled();
      }).catch(() => { /* Fall back to display mode and installation events. */ });
    }
    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', markInstalled);
      displayMode.removeEventListener('change', onDisplayMode);
    };
  }, []);

  async function install() {
    if (!prompt || installing) return false;
    setInstalling(true);
    setPrompt(undefined); // Browser install prompts can only be used once.
    try {
      const result = await prompt.prompt();
      if (result.outcome === 'accepted') {
        rememberInstallation(true);
        setInstalled(true);
      }
      return true;
    } catch { return false; }
    finally { setInstalling(false); }
  }

  return { installed, installing, install };
}

export function InstallApp({ installed, installing, install }: ReturnType<typeof useAppInstall>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const macSafari = !ios && /Macintosh/.test(navigator.userAgent)
    && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);

  useEffect(() => { if (installed) dialog.current?.close(); }, [installed]);
  if (installed) return null;
  return <>
    <button type="button" className="install-app-button" disabled={installing} aria-haspopup="dialog" aria-controls="install-app-instructions" aria-expanded={open} onClick={async () => {
      if (!await install()) { dialog.current?.showModal(); setOpen(true); }
    }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" /></svg>
      <span>{installing ? 'Installing…' : 'Install as App'}</span>
    </button>
    <dialog id="install-app-instructions" ref={dialog} className="install-app-dialog" aria-labelledby="install-app-title" onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <div className="install-app-heading">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="48" height="48" alt="" />
        <h2 id="install-app-title">Install SLSCC Band</h2>
        <button type="button" className="install-app-close" aria-label="Close installation instructions" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p>Keep your band practice one tap away with an app icon on your {ios ? 'Home Screen' : 'device'}.</p>
      {open ? ios ? <ol>
        <li>Open this site in <strong>Safari</strong>.</li>
        <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> (you may need to scroll).</li>
        <li>If shown, enable <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
      </ol> : macSafari ? <ol>
        <li>Open Safari’s <strong>File</strong> menu.</li>
        <li>Choose <strong>Add to Dock</strong>, then <strong>Add</strong>.</li>
      </ol> : <>
        <ol>
          <li>Open your browser’s menu or look for the install icon in the address bar.</li>
          <li>Choose <strong>Install SLSCC Band</strong>, <strong>Install app</strong> or <strong>Add to Home Screen</strong>, then confirm.</li>
        </ol>
        <p className="install-app-note">If no install option appears, try Chrome or Edge, or Safari on an iPhone or iPad.</p>
      </> : null}
      <button type="button" className="install-app-done" onClick={() => dialog.current?.close()}>Got it</button>
    </dialog>
  </>;
}
