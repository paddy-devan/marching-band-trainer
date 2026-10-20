import type { Page } from '@playwright/test';
import type { Transport } from '../../src/audio/transport';

// Gesture and audio checks need exact sub-bar clock positions even though the
// practice UI now seeks in bars. Capture its transport transiently through the
// existing Restart action, without adding a test-only API to the application.
export function practiceTime(page: Page, seconds: number | null = null): Promise<number> {
  return page.evaluate(async seconds => {
    const modulePath = '/src/audio/transport.ts';
    // Vite may add an HMR revision to the module URL. Use the same module as
    // the mounted app so this also works against a running development server.
    const moduleUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === modulePath)?.name ?? modulePath;
    const { Transport } = await import(/* @vite-ignore */ moduleUrl);
    const restart = Transport.prototype.restart;
    let position: number | undefined;
    Transport.prototype.restart = function (this: Transport) {
      if (seconds !== null) this.seek(seconds);
      position = this.getSnapshot().position;
    };
    try {
      const button = document.querySelector<HTMLButtonElement>('.restart-button');
      if (!button) throw new Error('Practice transport is not available.');
      button.click();
      if (position === undefined) throw new Error('Practice transport was not captured.');
      return position;
    } finally {
      Transport.prototype.restart = restart;
    }
  }, seconds);
}
