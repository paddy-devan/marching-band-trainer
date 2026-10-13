import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function offlineApp(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'slscc-band-offline',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async closeBundle() {
      const directory = path.resolve(config.root, config.build.outDir);
      async function listFiles(folder: string): Promise<string[]> {
        const entries = await readdir(path.join(directory, folder), { withFileTypes: true });
        const nested = await Promise.all(entries.map(entry => entry.isDirectory()
          ? listFiles(path.posix.join(folder, entry.name)) : [path.posix.join(folder, entry.name)]));
        return nested.flat();
      }
      const files = (await listFiles('')).filter(file => file !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const file of files) { hash.update(file); hash.update(await readFile(path.join(directory, file))); }
      const version = hash.digest('hex').slice(0, 16);
      const urls = ['./', ...files.filter(file => file !== 'index.html').map(file => `./${file}`)];
      await writeFile(path.join(directory, 'sw.js'), `
const prefix = 'slscc-band:' + self.registration.scope + ':';
const cacheName = prefix + '${version}';
const root = self.registration.scope;
const assetRoot = new URL('./assets/', root).href;
const scoreRoot = new URL('./generated/scores/', root).href;
const urls = ${JSON.stringify(urls)}.map(url => new URL(url, root).href);
const assets = new Set(urls);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(urls)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== new URL(root).origin || !url.href.startsWith(root)) return;
  const navigation = request.mode === 'navigate';
  // Also retain new hashed assets served while a newer worker waits to activate.
  if (!navigation && !assets.has(url.href) && !url.href.startsWith(assetRoot) && !url.href.startsWith(scoreRoot)) return;
  const fresh = navigation || url.pathname.endsWith('/catalogue.json') || url.pathname.endsWith('/manifest.webmanifest');
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // Hosts may vary static responses by Origin; module requests use different
    // headers from precaching. These same-origin public files are identical.
    const cached = await cache.match(navigation ? root : request, { ignoreVary: true });
    if (cached && !fresh) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        try { await cache.put(navigation ? root : request, response.clone()); }
        catch { /* A full cache must not prevent online practice. */ }
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
`);
    },
  };
}

export default defineConfig({ plugins: [react(), offlineApp()], base: process.env.VITE_BASE || '/' });
