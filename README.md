# Marching Band Trainer

A static practice app that reads original MuseScore archives, plays the parts together or separately, and follows a selected instrument. Built with React, TypeScript, Vite, `fflate` and native Web Audio. No backend, database, authentication, MuseScore process or MIDI exports are needed.

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

Alternatively, use an installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. To test another browser engine, install it with `npx playwright install firefox` or `npx playwright install webkit`, then run `PLAYWRIGHT_BROWSER=firefox npm run test:e2e` or `PLAYWRIGHT_BROWSER=webkit npm run test:e2e`.

The tests start the dev server automatically unless one is already running. To check a production preview or subpath instead, set `E2E_URL=http://127.0.0.1:4173/band/`. Temporary browser results and screenshots go to the system temporary directory; set `PLAYWRIGHT_OUTPUT_DIR` to change the results directory.

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
| Preview branch builds | Enabled (Previews Base) |
| Preview command | `npx wrangler preview` |

Cloudflare automatically installs dependencies using the committed `package-lock.json`. `ci:build` runs the parser and transport tests before type checking and building. Failed checks stop deployment. Use Cloudflare's generated Workers Builds token or an existing appropriately scoped deployment token; credentials stay in Cloudflare's build settings, never in frontend assets, source files or chat. See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Pushes to non-production branches automatically build and deploy a separate Worker Preview. `wrangler.json` includes the required empty `previews` block; the static assets and compatibility settings remain at the top level. Without that block, `npx wrangler preview` fails after a successful build. The `preview_urls: false` setting controls legacy version URLs and does not disable the separate Worker Previews workflow. See [Worker Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).

To inspect an automatic branch build, select its preview name in the dropdown next to the Worker's name, then open **Deployments → Build history**. Production build history only shows production builds. For this branch, the stable preview URL is `https://bell-lyre-game-marching-band-trainer.p-devaney96.workers.dev/` and becomes usable after a successful preview deployment. Production and Previews Base have separate build variables; the current preview environment uses the build image's default Node version, while production explicitly sets `NODE_VERSION=24` and `VITE_BASE=/`.

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

### Flams

A single pre-note snare acciaccatura or appoggiatura plays as a flam. The quiet grace stroke uses its own written hand and precedes the main hit by 35 ms at 100% speed; the gap scales with practice speed and shortens in dense passages. The main hit keeps its written beat, hand, accent and dynamic, and grace notes consume no metrical time. Opening flams include their pre-beat stroke on playback and restart. The grace stick prepares close to the head, then makes a small downstroke that scales with its strength (eight degrees for an ordinary mf flam, capped at ten degrees). Bar cues label the main note as a flam. Both strokes have separate falling cues and must be played in Drum challenge, including an opening grace stroke just before the count-in reaches the main beat. Multi-note grace groups, after-graces, other instruments and unattached grace notes remain unsupported and produce a diagnostic.

### Drum animation

The snare animation reads the audible output clock each animation frame, using the transport's device-latency fallback when needed. On single strokes the stick approaches the head before contact, holds briefly, then rebounds. Stick height follows the passage dynamic, including saved MuseScore playback velocities. Unmarked music defaults to mf in both sound and animation; an ordinary mf stroke retains the original 19.5-degree travel to the head. Written accents increase the preparation height relative to that dynamic (39.5 degrees at mf), so a p accent stays lower than an f accent. The highest preparation is capped at 55 degrees. Each hand recovers directly towards the height required by its next stroke: high-to-high full strokes, high-to-low down strokes, low-to-low taps and low-to-high up strokes. This replaces a rebound to the previous dynamic followed by a late corrective lift. Consecutive same-hand strokes up to 1.25 score seconds apart prepare during recovery; across longer gaps the stick relaxes and prepares over the final 200 ms before its downstroke. This gap rule follows score time so practice speed changes preserve the choice of gesture, while movement controls remain real milliseconds. Contact timing is unchanged. After its final roll press, a hand prepares its next single stroke directly, even while the other hand finishes the roll; ongoing roll handovers and flam grace strokes retain their shallow motion. During rolls it makes tiny bounces aligned with the audio contacts (four per quaver), followed by a shallow recovery lift between turns; both scale with dynamics, with eight degrees of recovery at mf. Adjoining same-hand rolls recover within the final contact interval; alternating-hand rolls recover while the other hand plays. A full rebound follows the end of the continuous roll passage; real gaps and ordinary strokes still release. Dense same-hand notes shorten gestures and effects to separate strikes. Buzz lines appear only on roll movements. Unspecified hands retain the neutral indicator.

The gesture model is a small deterministic visual approximation, not a physical simulation. Score interpretation supplies the hand, timing, dynamic, accent and roll spans. The animation calculates preparation height, then evaluates a single recovery/downstroke trajectory or a compact roll trajectory at the requested clock position. It has no frame-dependent state or timers, so seeking, pausing and changing speed reproduce the same poses. Audio scheduling and challenge scoring remain separate.

## Bell lyre challenge

Choose **Bell lyre challenge** on a score with a playable lyre part. The dedicated screen replaces the normal score controls with a touchable instrument. Phone portrait is the primary layout; mouse and keyboard activation of the note buttons also work on desktop. Challenge links use `#colonel-bogey/challenge`; browser Back/Forward works between the score and challenge.

Before starting, choose 25–150% speed, advance note outlines, a metronome, and optional bell lyre backing. Defaults are 75% speed, outlines on, and metronome/backing off. A full-bar audible count-in follows the piece's starting meter, including compound beats and pickups. Taps during the count-in let the player find the bars and do not affect the score. All percussion parts stay audible regardless of the normal score's mute/solo controls. Each tap sounds its actual pitch, independently of the quieter automatic lyre backing.

Tap each written attack once. Joined ties require one strike; repeated notes require separate strikes; simultaneous pitches accept separate fingers. The lyre fills the available screen below a compact feedback line, with no note list or instruction text during play. Advance outlines appear up to 0.8 seconds before the next attack. Perfect hits briefly pop up in purple, and a perfect-streak counter appears from three consecutive perfect attacks. The counter stays anchored on the right with tabular digits; at 10, 20, and 30 it gains brighter colour, a soft glow, then a gently animated spark (disabled with reduced motion). Early/late hits, misses, and wrong/extra taps break the streak without displaying a negative message. The result reports the longest perfect streak. Timing uses input timestamps mapped to the audio output clock where supported, with a latency-based fallback. Output timestamps must be finite, recent and consistent with the rendering clock. Invalid, negative or greater-than-two-second device latency reports are ignored; an unreliable output clock falls back to the rendering clock with valid latency compensation. This prevents incorrect mobile browser reports from freezing cues and scoring while audio continues. The full-credit window is at most ±65 ms, with decreasing partial credit out to ±150 ms. Closely spaced attacks narrow the windows to avoid claiming the neighbouring note; perfect hits allow 65% of that narrowed window. These windows use real time at every speed.

The result is an **integer number of stars out of ten**: weighted hit credit, less 0.25 points per wrong/extra tap, divided by the number of expected attacks, multiplied by ten, rounded, and clamped to 0–10. Missing notes earn zero; tapping repeatedly cannot claim the same attack twice. All ten grey stars appear immediately, then the earned stars fill one at a time at 240 ms intervals with ascending synthesized chimes (about 2.5 seconds for all ten). Star sounds can be switched off, and reduced-motion preferences remove the pop animation. Accuracy is separate from assistance: slower or aided attempts can still earn ten stars, with their settings shown beside the result.

Results exist only in memory and are cleared when retrying, leaving, or reloading. Stop returns to setup with the chosen settings. Backgrounding the page or losing audio interrupts the attempt and offers a fresh start without awarding a partial score. Parts containing notes outside their configured lyre register do not offer the challenge.

Challenge animation reads the audio clock without rerendering the screen each frame. React updates only when cues, feedback, count-in, the displayed bar or streak change; drum notes move using transforms with cached, resize-aware geometry. Progress updates ten times per second. Target lookups use an onset index, and missed-note expiry advances through each target once while preserving credit for delayed input timestamps. Tap colours change immediately. Fixed challenge mixes skip muted audio synthesis; practice still schedules muted notes so unmuting a held note remains immediate. Shared snare noise is prepared before playback rather than on the first tap.

Unit checks cover scoring, chords, duplicate unisons, ties, repeat passes, speed, count-in, compound meter, and audio timing/cancellation. Browser checks cover entry/settings, touch input, responsive bounds, history, interruptions, ten sequential star reveals with scheduled sounds, zero-star attempts, retry, streak tiers and stable counter placement, and reduced motion. Real iOS/Android touch feel and audio latency still need device verification.

## Drum challenge

Choose **Drum challenge** on a score with a side/snare drum part, or open a direct link such as `#16obr/drum-challenge`. Drum and bell lyre challenges share the setup, count-in, progress, streaks, results, retry and interruption handling. Drum defaults are 75% speed, cues on, and metronome/drum backing off. Other parts play as accompaniment; the selected drum part only plays automatically when Drum backing is enabled. Every player tap sounds a short snare strike independently of backing.

Two large pads represent the left and right sticks. Tap with a mouse or separate touch pointers, use **F** for left and **J** for right, or focus either button and activate it with the keyboard. Holding a key does not generate repeated strikes. With advance cues enabled, bars descend over a two-second real-time preview towards matching outlines just above the drum head. Strike when a bar completely overlaps its outline: left/right bars specify sticking, and a single neutral **Either** bar spans both lanes for an unspecified hand. With cues off, no note prompts appear before or at an attack; the pads only respond to player input. Metronome and backing remain separate options. No haptics are used.

Drum timing, weighted hit credit, stars and streaks use the same rules as the lyre. Either pad can claim an unspecified attack once; another tap is extra. A wrong-hand strike consumes the expected attack as a miss, breaks the streak, and receives no additional extra-tap penalty. It cannot be corrected by a second strike. Repeated same-hand notes remain separate attacks. Simultaneous opposite-hand targets accept separate fingers. Duplicate same-hand/onset voices require one strike. Roll targets follow the existing interpreted instructional movements, not the individual audio contacts; unspecified rolls remain unspecified.

Unit checks cover known/unknown sticking, terminal wrong-hand misses, simultaneous hands, duplicate voices, dense rolls, repeat passes, speed, delayed input timestamps and live percussion sound. Browser checks exercise shared setup/results, touch and F/J input, falling notes, cues-off attempts, wrong/extra taps, retry, history, interruption, unavailable parts, and phone/desktop/landscape bounds. Physical phone input and audible latency still need device verification.

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

- `repertoire` (default): semiquaver hand movements in simple time; quaver movements in compound /8 meters such as 6/8, 9/8 and 12/8 (numerator greater than three and divisible by three). A quaver roll produces one skeleton movement; a dotted-crotchet roll produces three. Simple 3/8 retains semiquaver spacing.
- `sixteenth`: semiquaver movements regardless of meter.
- `eighth`: quaver movements regardless of meter.
- `disabled`: do not expand rolls; keep a parser diagnostic.

Supported snare roll marks are `r8`, `r16` and `r32` on any note duration. All three use the same roll playback; slash count does not set the contact or hand-change rate. A single-slash semiquaver (as in Heart of Oak) plays as a same-hand double stroke: one instructional movement with two evenly spaced audio contacts within the semiquaver. Tied segments that both carry roll marks join before expansion; phase continues across bar lines over a half-open span with no duplicate boundary attack. A snare roll tied into an unmarked note ends at that note's onset and plays one release tap with its written hand, accent and dynamic. Ordinary tied notes still join as one event; a roll starting partway through a snare tie chain begins at the first marked note. Unknown starting hands remain unspecified. Roll audio uses **four evenly spaced synthetic strikes per quaver**, independent of the hand-change profile: two contacts per semiquaver movement or four per quaver movement. Contact velocity follows the score dynamics at a uniform reduced roll level, without restarting a fading accent on each hand change. Each snare voice combines filtered procedural noise with a short sine-wave membrane resonance. A sharp attack drops into a quieter 180 ms rattle tail, independent of strike spacing and playback speed, allowing controlled overlap. Each contact starts at a different noise-buffer offset. A faint, generated 220 ms room response adds space; both dry sound and reverb obey mute/solo, and transport interruptions clear the reverb. No recorded samples or external audio assets are used. The clock-driven stick stays near the head throughout each press, with tiny bounces aligned to these contacts, then rebounds after release. Other tremolos play as single events; parser diagnostics remain available on the timeline model.

Bell lyre audio uses a procedural struck-metal-bar voice: a clear sine fundamental with quieter inharmonic overtones that fade faster than the main note. High overtones are softened and modes above the usable sample-rate range are omitted to keep the upper register gentle. Written note lengths gently damp the ringing tail; free challenge taps use its full natural decay. Playback speed changes written damping without changing pitch, and pause/seek cancels every mode. Other pitched parts use decaying triangle oscillators. Bass drum uses a decaying low sine, and snare uses high-passed noise. Left and right snare identifiers use the same sound. Cymbal parts, identified by their part name or instrument ID, play the supplied marching hand-cymbal recording. The app downloads the roughly 191 KB AAC recording in `samples/`. Playback skips its 30 ms contact-noise lead-in so the main crash lands on the beat, with a 1 ms fade to avoid a click. Playback waits for loading and decoding before starting the score clock and reuses the decoded buffer for each hit. Quieter hits use a lower gain and a lower low-pass cutoff to approximate lighter contact with the same recording. Written note lengths control gentle damping at the end; ties produce one crash ringing across the combined duration. Changing playback speed changes the damping time without stretching the sample or changing its pitch. Unmeasured practice taps keep the full recorded decay. Volume, mute/solo and transport cancellation apply to the whole sound. A failed download or decode shows a retry message. These are approximate practice sounds, not MuseScore or Muse Sounds reproduction; filtering a full crash cannot reproduce every detail of a separately recorded light crash. The configuration's register transpose is separate from tempo/speed, and is never inferred by forcing every score into the instrument range.

## Supported notation and limitations

Verified native format: **MuseScore XML 4.70**, from the supplied `.mscz` fixtures. Other numeric 4.x versions are attempted with a warning; other major versions are rejected. Archive decoding follows `META-INF/container.xml`, then falls back only to a unique suitable root-level `.mscx`. Malformed or ambiguous archives are reported per file without preventing other scores from loading. Archive and selected XML size are limited to 20 MB.

Supported: repeat barlines, repeat counts, nested repeats and multi-bar/multi-pass volta endings; standard durations through 1024ths, dots, tuplets (including nested groups, chords and rests), full-measure rests, explicit pickup lengths, snare flams, rests, chords, multiple voices and staffs, numeric tempo changes across parts, key/time-signature changes, native note pitch and `tpc` spelling, position-anchored single R/L sticking, named drum hands, static dynamics, accents, native next/prev tie locations, and the repertoire's single-chord snare rolls. Static dynamics persist within their part across bars and rests, respect saved MuseScore playback velocities (or use the standard level for the marking), and reset on repeat returns; marks in skipped endings do not affect subsequent playback. Accents boost the current dynamic rather than always playing at full volume. Drum accents receive an additional 1.6× playback gain after score-velocity clamping, making accented snare and bass drum strikes clearer at louder dynamics without changing ordinary hits or quiet flam grace strokes. Tuplet ratios scale written durations exactly within each voice; malformed ratios or unmatched group boundaries are rejected. Exact rational quarter-note units are retained until conversion through the shared tempo map.

Not yet faithfully interpreted:

- Navigation jumps (D.C./D.S., Coda/Fine) and measure-repeat symbols are not expanded. Repeat barlines and volta endings are expanded before playback, including Colonel Bogey’s first and second endings.
- Grace notes other than the supported single pre-note snare flams: detected and omitted.
- Instrument changes, octave spanners and two-chord tremolos: detected and warned; stored pitches remain the playback source.
- Compressed multimeasure rests, cross-measure voice locations and mid-bar time-signature changes: limited; warnings explain affected cases.
- Hairpins, changing dynamics within a held note, special dynamic attacks such as sfz, other articulations, fermatas and swing are not interpreted. Dynamics are part-wide; staff-only dynamic scope is not distinguished. Snare and bass drum sounds decay naturally; cymbal note lengths determine damping rather than synthesizing a sustain beyond the recorded tail.
- Tied rolls changing meter preserve the initial skeleton interval and warn. Invalid tie relationships play separately with a warning.

The visible instrument renderer is a replaceable SVG placeholder, not a full sheet-music engraver. A physical instrument's octave, sound quality, and real-phone audio behaviour need user/device verification.

## Code structure and checks

- `scripts/prepare-scores.mjs`: reproducible static assets and catalogue.
- `src/score/archive.ts`, `xml.ts`, `parser.ts`, `fraction.ts`, `model.ts`: decoding, ordered parsing and exact score model.
- `src/score/repeats.ts`: repeat/ending order, shared playback expansion, tempo/key restoration and ties across adjacent played bars. Written bar numbers remain visible while seek/time use the expanded duration. Expansion is bounded to 10,000 bars and 200,000 notes.
- `src/score/interpret.ts`: native tie joins, roll skeletons, tempo conversion and separate audio contacts.
- `src/audio/transport.ts`: audio-clock scheduling, cancellation and per-part mixing.
- `src/audio/beats.ts`, `src/game/scoring.ts`: count-in/metronome timing and shared lyre/drum challenge judging.
- `src/game/parts.ts`: playable challenge parts.
- `src/ui/Challenge.tsx`, `LyreBoard.tsx`, `DrumBoard.tsx`: shared challenge screens and instrument boards.
- `src/ui/`: catalogue, transport/part controls, practice screen and instrument renderers. Renderers consume normalised movements rather than native XML.
- `tests/`: fixture/synthetic notation tests, catalogue regeneration, deterministic transport tests and real-browser interaction checks.

Automated checks cover the 43 resolved side-drum notes in 16 OBR, 123 drum notes using the Left stick / Right stick mapping and 24 roll marks in Colonel Bogey, the fully marked tied minim-plus-quaver's ten movements, McAlpine's 25 roll releases and 18 flams, accented release taps, release timing across bars and repeat passes, three-note tie chains, dotted 6/8, 9/8 and 12/8 rolls, Ready Aye Ready's single-movement pickup, compound roll ties, simple 3/8 and explicit roll-profile overrides, shared tempo changes, spelling/octaves, multi-staff/voice alignment, unresolved configuration, archive errors, cancellations, immediate gains and real UI state. Browser QA uses desktop and emulated phone/tablet widths; this does not establish compatibility with actual iOS/Android hardware. An analyser verifies nonzero Web Audio output and silence after muting; sound quality has not been listened to.
