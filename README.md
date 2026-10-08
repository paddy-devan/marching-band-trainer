# Marching Band Trainer

A static practice app that reads original MuseScore archives, plays the parts together or separately, and follows one selected instrument. Built with React, TypeScript, Vite, `fflate` and native Web Audio. No backend, database, authentication, MuseScore process or MIDI exports are needed.

## Run locally

Use Node.js **22.12+ in the 22.x line, 24.x, or 26+**, and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173/). Scores are prepared automatically before starting development. Serve the app over HTTP; opening `index.html` with `file://` is unsupported.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

For browser tests, install Playwright's Chromium once:

```sh
npx playwright install chromium
npm run test:e2e
```

Alternatively, use an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. The tests start the dev server automatically unless one is already running. To check a production preview or subpath instead, set `E2E_URL=http://127.0.0.1:4173/band/`. Temporary browser results and screenshots go to the system temporary directory; set `PLAYWRIGHT_OUTPUT_DIR` to change the results directory.

## Add the next score

1. Put a `.mscz` file into repository-root **`scores/`**. Keep filenames stable; they are application score IDs.
2. Restart `npm run dev`, or run `npm run build` for production. `npm run scores` can also regenerate assets while the dev server is running; reload the browser afterwards.
3. Check the title, parts and playback in the app. Configure unusual instruments if needed.

The preparation script enumerates `.mscz` files automatically, copies the originals to `public/generated/scores/`, and creates a filename/URL catalogue. Content hashes in asset URLs prevent stale caches after score edits. The browser reads visible titles from the score XML and caches parsed scores for the session. Files load progressively: the first score is usable while the rest are read. Removing or changing a source file and rebuilding replaces the generated catalogue and assets. Teachers do not edit manifests, pitches or MIDI exports.

`scores/` is canonical and belongs in Git. `public/generated/`, `node_modules/` and `dist/` are disposable and ignored. The three supplied files are preserved, including `hollyrood.mscz`, whose visible title is **Holyrood**.

## Static deployment

`npm run build` produces **`dist/`**, containing everything needed by a static HTTP host. Copy that directory to the host. No Node.js process is needed in production.

For deployment under a subpath, configure Vite's base:

```sh
VITE_BASE=/band/ npm run build
VITE_BASE=/band/ npm run preview
```

Alternatively, `npm run build -- --base=/band/` uses Vite's command-line option. All catalogue and score fetches respect the base URL; URLs with spaces are encoded. Configure the base before building. New repository scores require rebuilding and redeploying; the deployed app does not monitor a teacher's computer.

### Cloudflare deployment from main

This repository is connected to **Cloudflare Workers Builds**, Cloudflare's built-in GitHub integration, with **`main`** as the production branch. Cloudflare installs locked dependencies, runs the build command and deploys successful commits automatically. No GitHub Actions workflow or GitHub deployment secret is required.

Live app: [marching-band-trainer.p-devaney96.workers.dev](https://marching-band-trainer.p-devaney96.workers.dev/).

`wrangler.json` targets **`marching-band-trainer`** in **Paddys Account**, account ID `4d7d280c95494925dda1b23cbb7ae0f8`. It serves `dist/` with Cloudflare Workers Static Assets and uses a `workers.dev` URL. There is no Worker script, server-side application code, custom domain or paid-plan change. Missing score/assets URLs return 404 rather than the app HTML. Production builds use the URL root (`VITE_BASE=/`).

Manage these settings in **Cloudflare → Workers & Pages → marching-band-trainer → Settings → Builds**:

| Setting | Value |
| --- | --- |
| Git repository | `paddy-devan/marching-band-trainer` |
| Production branch | `main` |
| Root directory | Repository root (`/`) |
| Build command | `npm run ci:build` |
| Deploy command | `npm run deploy` |
| Build environment variable | `NODE_VERSION=24` |
| Build environment variable | `VITE_BASE=/` |
| Non-production branch builds | Disabled |

Cloudflare automatically installs dependencies using the committed `package-lock.json`. `ci:build` runs the parser and transport tests before type checking and building. Failed checks stop deployment. Use Cloudflare's generated Workers Builds token or an existing appropriately scoped deployment token; credentials stay in Cloudflare's build settings, never in frontend assets, source files or chat. See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Local checks and deployments:

```sh
npm run build
npm run deploy:check  # validates packaging without uploading or publishing
npm run deploy       # publishes dist/ using Wrangler login or an API token
```

The local Wrangler OAuth sign-in is separate from the Workers Builds token. Do not copy its access or refresh tokens into the repository or CI settings. `npm run deploy` publishes the existing `dist/`; rebuild first when deploying manually. Pushing a new score on `main` automatically regenerates the catalogue and publishes it after checks pass. Build logs and deployment status are available in the Worker's **Deployments** tab. To roll back, redeploy a previous version in Cloudflare or revert the change on `main` and let the pipeline publish it.

## Practice controls

Link directly to a score with its filename ID as a URL fragment, for example `https://band.southliverpoolscc.org/#colonel-bogey`. Selecting a score updates the fragment, and browser Back/Forward restores previous selections. Opening the app without a fragment shows a neutral, searchable score list; no score is selected. Returning to the bare URL, including with browser Back, shows that list again. Missing or unreadable linked scores show an error and let you choose another score. Keep score filenames stable so shared links continue to work.

- Play/pause, restart, seek and change speed from 25–150%. The tempo control shows both the current crotchet BPM and the speed percentage. Speed affects timing, not pitch.
- Mute individual parts or solo one or more. Mute takes precedence over solo; multiple soloed parts play together. Gain nodes apply changes immediately to scheduled and current sounds.
- Use the eye icon to select the visualised part independently of the audio mix. The speaker icon mutes a part; the headphones icon solos it. All part controls are in the playback panel. Muted parts can still be visualised.
- Read the entire current bar of pitches or sticking, with the next played bar queued below. Simultaneous pitches display together, and rests remain visible. Highlights follow the instrument, briefly releasing between repeated strikes while tied notes remain continuous across bars. Compound meters such as 12/8 count dotted-crotchet beats; the tempo label still uses crotchet BPM from the score.
- Note labels always use sharps to match the bell lyre. Octaves remain distinct.
- The lyre beater stays visible, hovers above the first note before playback, then rebounds and moves toward the next played note. Its motion follows playback speed and pauses with the transport.
- Controls use native keyboard interactions and large touch targets. Reduced-motion preferences keep highlights, note labels and a stationary beater cue above the next note while disabling stick movement and animated beater travel.

Audio starts after pressing Play. The transport uses the Web Audio clock with a short lookahead, and visual state derives from that clock. Pause, seek, speed changes, restart and score changes cancel scheduled sources. A suspended audio context pauses the transport and prompts the student to press Play again. Skipped scheduling windows after background-tab delays do not replay old attacks in a burst.

## Bell lyre challenge

Choose **Bell lyre challenge** on a score with a playable lyre part. The dedicated screen replaces the normal score controls with a touchable instrument. Phone portrait is the primary layout; mouse and keyboard activation of the note buttons also work on desktop. Challenge links use `#colonel-bogey/challenge`; browser Back/Forward works between the score and challenge.

Before starting, choose 25–150% speed, advance note outlines, a metronome, and optional bell lyre backing. Defaults are 75% speed, outlines on, and metronome/backing off. A full-bar audible count-in follows the piece's starting meter, including compound beats and pickups. Taps during the count-in let the player find the bars and do not affect the score. All percussion parts stay audible regardless of the normal score's mute/solo controls. Each tap sounds its actual pitch, independently of the quieter automatic lyre backing.

Tap each written attack once. Joined ties require one strike; repeated notes require separate strikes; simultaneous pitches accept separate fingers. Current-bar notes remain readable with advance outlines switched off. Timing uses input timestamps mapped to the audio output clock where supported, with a latency-based fallback. The initial full-credit window is at most ±50 ms, with decreasing partial credit out to ±150 ms. Closely spaced attacks narrow the windows to avoid claiming the neighbouring note. These windows use real time at every speed.

The result is an **integer number of stars out of ten**: weighted hit credit, less 0.25 points per wrong/extra tap, divided by the number of expected attacks, multiplied by ten, rounded, and clamped to 0–10. Missing notes earn zero; tapping repeatedly cannot claim the same attack twice. All ten grey stars appear immediately, then the earned stars fill one at a time with ascending synthesized chimes. Star sounds can be switched off, and reduced-motion preferences remove the pop animation. Accuracy is separate from assistance: slower or aided attempts can still earn ten stars, with their settings shown beside the result.

Results exist only in memory and are cleared when retrying, leaving, or reloading. Stop returns to setup with the chosen settings. Backgrounding the page or losing audio interrupts the attempt and offers a fresh start without awarding a partial score. Parts containing notes outside their configured lyre register do not offer the challenge.

Unit checks cover scoring, chords, duplicate unisons, ties, repeat passes, speed, count-in, compound meter, and audio timing/cancellation. Browser checks cover entry/settings, touch input, responsive bounds, history, interruptions, ten sequential star reveals with scheduled sounds, zero-star attempts, retry, and reduced motion. Real iOS/Android touch feel and audio latency still need device verification.

## Instrument and interpretation configuration

Edit **`trainer.config.json`** only for exceptions. Do not duplicate titles, tempo, keys or note sequences. Each entry uses the score filename without `.mscz`, an exact visible part name, and optionally the native instrument ID:

```json
{
  "scores": {
    "colonel-bogey": {
      "parts": [
        {
          "part": "Bell Lyre",
          "instrument": "piano",
          "renderer": "lyre",
          "register": {
            "min": 81,
            "max": 105,
            "transpose": 24,
            "provisional": true
          }
        },
        { "part": "Side Drum", "rollProfile": "repertoire" }
      ]
    }
  }
}
```

Renderers are `lyre`, `snare` and `pulse`. Lyre range limits are MIDI sounding pitches. `transpose` is the semitone offset from the stored score pitch, used for both synthesised audio and bar highlighting. Out-of-range notes are identified rather than mapped to another octave.

The supplied photograph establishes 25 chromatic bars spanning A–A, with naturals on the right, accidentals on the left, increasing upwards. The **A5–A7 sounding range and +24-semitone mapping are provisional**, chosen with user approval. Comparable instruments use that range ([Musser catalogue](https://www.ludwig-drums.com/application/files/7214/6531/8332/AV8084_2013.pdf)); it is not a verified measurement of this Mayfield instrument. Colonel Bogey's stored C4–F5 pitches map to C6–F7. The same provisional register is configured for Holyrood. Adjust the mapping after checking the real instrument with a tuner. Bar positions use diatonic spacing with accidentals staggered between the naturals.

Part IDs use `score-id:normalised-part-name:instrument-id`. Duplicates receive a document-order suffix and a warning. Staffs retain their native IDs, or their document-order IDs where the definition omits them; a part can contain several staffs. Overrides must resolve to exactly one part; unresolved or ambiguous selectors produce warnings. Renaming a part or changing its instrument requires updating its override. MuseScore online IDs and revision metadata are never used as local part IDs.

Sticking priority is explicit position-anchored annotation, named drum mapping, configured staff-line mapping, then unspecified. `positionHands: { "upper": "R", "lower": "L" }` can be configured when drum definitions contain usable signed staff lines (negative = above, positive = below). Explicit annotations win over conflicting mappings and generate a warning. Repeated same-hand strokes and rests retain the written rhythm. **Unspecified sticking uses a neutral central strike and no animated left/right stick.** Audio still plays. Missing sticking is summarised once per snare part.

`rollProfile` options:

- `repertoire` (default): semiquaver hand movements in simple time; quaver movements in 12/8.
- `sixteenth`: semiquaver movements regardless of meter.
- `eighth`: quaver movements regardless of meter.
- `disabled`: do not expand rolls; keep a parser diagnostic.

Supported snare roll marks are `r16` and `r32`. Slash count does not set the hand-change rate. Tied roll segments join before expansion; phase continues across bar lines over a half-open span with no duplicate boundary or extra final attack. Unknown starting hands remain unspecified. The first version approximates roll audio with **two decaying noise contacts per skeleton movement**, generated separately from hand movements. Other tremolos play as single events; parser diagnostics remain available on the timeline model.

Pitched audio uses decaying triangle oscillators, with a slightly longer ringing tail for the bell lyre. Bass drum uses a decaying low sine, and snare uses high-passed noise. Left and right snare identifiers use the same sound. These are approximate practice sounds, not MuseScore or Muse Sounds reproduction. The configuration's register transpose is separate from tempo/speed, and is never inferred by forcing every score into the instrument range.

## Supported notation and limitations

Verified native format: **MuseScore XML 4.70**, from the supplied `.mscz` fixtures. Other numeric 4.x versions are attempted with a warning; other major versions are rejected. Archive decoding follows `META-INF/container.xml`, then falls back only to a unique suitable root-level `.mscx`. Malformed or ambiguous archives are reported per file without preventing other scores from loading. Archive and selected XML size are limited to 20 MB.

Supported: repeat barlines, repeat counts, nested repeats and multi-bar/multi-pass volta endings; standard durations through 1024ths, dots, full-measure rests, explicit pickup lengths, rests, chords, multiple voices and staffs, numeric tempo changes across parts, key/time-signature changes, native note pitch and `tpc` spelling, position-anchored single R/L sticking, named drum hands, accents, native next/prev tie locations, and the repertoire's single-chord snare rolls. Exact rational quarter-note units are retained until conversion through the shared tempo map.

Not yet faithfully interpreted:

- Navigation jumps (D.C./D.S., Coda/Fine) and measure-repeat symbols are not expanded. Repeat barlines and volta endings are expanded before playback, including Colonel Bogey’s first and second endings.
- Tuplets: detected and warned; ordinary written durations are used as an approximation.
- Grace notes: detected and omitted.
- Instrument changes, octave spanners and two-chord tremolos: detected and warned; stored pitches remain the playback source.
- Compressed multimeasure rests, cross-measure voice locations and mid-bar time-signature changes: limited; warnings explain affected cases.
- Dynamics beyond accents, articulations, fermatas and swing are not interpreted. Single-contact percussion sounds decay naturally rather than sustain for the full written duration.
- Tied rolls changing meter preserve the initial skeleton interval and warn. Invalid tie relationships play separately with a warning.

The visible instrument renderer is a replaceable SVG placeholder, not a full sheet-music engraver. A physical instrument's octave, sound quality, and real-phone audio behaviour need user/device verification.

## Code structure and checks

- `scripts/prepare-scores.mjs`: reproducible static assets and catalogue.
- `src/score/archive.ts`, `xml.ts`, `parser.ts`, `fraction.ts`, `model.ts`: decoding, ordered parsing and exact score model.
- `src/score/repeats.ts`: repeat/ending order, shared playback expansion, tempo/key restoration and ties across adjacent played bars. Written bar numbers remain visible while seek/time use the expanded duration. Expansion is bounded to 10,000 bars and 200,000 notes.
- `src/score/interpret.ts`: native tie joins, roll skeletons, tempo conversion and separate audio contacts.
- `src/audio/transport.ts`: audio-clock scheduling, cancellation and per-part mixing.
- `src/audio/beats.ts`, `src/game/scoring.ts`: count-in/metronome timing and stateless bell lyre challenge judging.
- `src/ui/`: catalogue, transport/part controls, practice screen and instrument renderers. Renderers consume normalised movements rather than native XML.
- `tests/`: fixture/synthetic notation tests, catalogue regeneration, deterministic transport tests and real-browser interaction checks.

Automated checks cover the 43 resolved side-drum notes in 16 OBR, 12 explicit sticking annotations and 24 roll marks in Colonel Bogey, the tied minim-plus-quaver's ten movements, three-note tie chains, dotted 12/8 rolls, shared tempo changes, spelling/octaves, multi-staff/voice alignment, unresolved configuration, archive errors, cancellations, immediate gains and real UI state. Browser QA uses desktop and emulated phone/tablet widths; this does not establish compatibility with actual iOS/Android hardware. An analyser verifies nonzero Web Audio output and silence after muting; sound quality has not been listened to.
