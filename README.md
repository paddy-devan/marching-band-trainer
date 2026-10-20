# Marching Band Trainer

A static web app for practising marching band repertoire from MuseScore files, with per-part audio controls, instrument visualisations and bell lyre/drum challenges. Built with React, TypeScript, Vite and Web Audio; no backend or running MuseScore installation is required. See [specification.md](specification.md) for current functionality, architecture and constraints.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173/). Scores are prepared automatically from `scores/` before the dev server starts. Serve over HTTP; opening `index.html` directly is unsupported.

## Deployment

Live app: [marching-band-trainer.p-devaney96.workers.dev](https://marching-band-trainer.p-devaney96.workers.dev/).

Cloudflare Workers Builds deploys `main` using `npm run ci:build`, then `npm run deploy`. Production build variables are `NODE_VERSION=24` and `VITE_BASE=/`. Other branches use `npx wrangler preview` for preview deployments. Build settings and deployment history are managed in Cloudflare under **Workers & Pages → marching-band-trainer**.

For a manual Cloudflare deployment, authenticate Wrangler locally and run:

```sh
npm run build
npm run deploy:check
npm run deploy
```

`wrangler.json` serves `dist/` as static assets. The deploy command publishes the existing build, so rebuild after changes. Roll back through Cloudflare's deployment history or by reverting the change on `main`.

For another static HTTP host, upload `dist/` after `npm run build`; no Node.js process is needed in production. Use `npm run preview` to check the build locally. For subpath hosting, build with the matching base, for example `VITE_BASE=/band/ npm run build`.
