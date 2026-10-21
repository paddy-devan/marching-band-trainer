# Marching Band Trainer specification

## Purpose and architecture

The app helps students practise marching band repertoire by listening to individual parts, following instrument animations and playing timed bell lyre or drum challenges. It is a static React/TypeScript application built with Vite. MuseScore archives are interpreted in the browser using `fflate` and native Web Audio; no backend, database, authentication, running MuseScore process or MIDI export is required.

The main data flow is:

```text
scores/ + scores.metadata.json → build-time catalogue and score assets
→ browser archive decoding and score parsing → repeat expansion and interpretation
→ shared timeline → audio transport, practice visuals and challenge targets
```

| System | Responsibility |
| --- | --- |
| `scripts/prepare-scores.mjs` | Generate the static catalogue and copies of source scores. |
| `src/score/` | Decode archives, parse notation, apply configuration, expand repeats and produce a timed model. |
| `src/audio/` | Schedule playback, synthesize instruments, load cymbal audio, mix parts and generate metronome/count-in clicks. |
| `src/game/` | Identify playable challenge parts, build targets and judge attempts. |
| `src/ui/` and `src/App.tsx` | Route between screens and render the catalogue, practice controls, instrument views and challenges. |

Audio, visuals and challenges consume the same interpreted timeline. Instrument renderers use normalized movements rather than native XML. Instructional movements and individual audio contacts are separate, particularly for rolls.

## Scores, metadata and configuration

### Source and generated content

Repository-root `scores/` contains the canonical `.mscz` files. Filenames without the extension are stable score IDs used by configuration, metadata and shared links. Titles, composers and musical content come from the score XML.

Preparation runs before development and production builds, or explicitly with `npm run scores`. It discovers scores automatically, copies them to `public/generated/scores/` and writes `public/generated/catalogue.json`. Asset filenames contain content hashes to invalidate edited scores. Generated assets and `dist/` are disposable; source archives are preserved unchanged. Adding, changing or removing a score requires regeneration and a browser reload locally, or a rebuild and deployment in production.

The browser loads and parses scores progressively, so available pieces can be used while others are still loading. Parsed timelines are cached for the session. A malformed score produces a per-file error without preventing other pieces from loading. All asset requests respect Vite's configured base URL.

### Catalogue metadata

`scores.metadata.json` is keyed by exact score ID. Each entry contains:

- `type`: `drum-solo` or `full-band`.
- `description`: a non-empty description, kept to at most two sentences by editors.
- `sources`: optional HTTP(S) reference URLs supporting historical claims.

Metadata supplements the score; it does not override its title or composer. Preparation rejects unknown score IDs, unknown fields, invalid types and invalid source URLs before replacing existing generated content. Metadata is optional for new scores. Without an explicit type, a loaded score containing only percussion parts is classified as a drum solo; otherwise it is full band.

### Interpretation overrides

`trainer.config.json` holds exceptions to automatic instrument interpretation. Overrides select a score ID and exact visible part name, optionally narrowed by native instrument ID. A selector must resolve to one part; unresolved or ambiguous matches produce warnings. Part identities derive from the local score, part name and instrument, with duplicate identities disambiguated and reported. Renaming scores or parts requires updating dependent metadata, links and overrides.

Overrides can set the renderer (`lyre`, `snare` or generic `pulse`), sounding register and semitone transpose, roll profile, and upper/lower staff-position hand mapping. They must not duplicate titles, tempos or note sequences. Register transpose affects audio and highlighting equally and is independent of playback speed. Out-of-range pitches are identified rather than moved into a different octave.

The bell lyre has 25 chromatic bars ascending from A to A, with naturals on the right and accidentals on the left. The configured A5–A7 sounding range and +24-semitone overrides are provisional and require verification against the physical instrument.

## Notation interpretation

Verified input is MuseScore XML 4.70 inside `.mscz` archives. Other numeric 4.x versions are attempted with a warning; other major versions are rejected. Archive decoding follows the container's master-score reference, with a fallback to a unique suitable root-level `.mscx`. Ambiguous or corrupt archives are rejected. Both compressed archives and the XML content selected for extraction are limited to 20 MB.

Supported notation includes multiple parts, staffs and voices; chords and rests; standard durations through 1024ths, dots, nested tuplets and explicit pickups; tempo, key and time-signature changes; static dynamics and accents; native ties; repeat barlines, repeat counts, nested repeats and multi-pass volta endings. Durations retain exact rational quarter-note units until conversion through the shared tempo map. Malformed tuplet structures are rejected.

Repeat expansion restores tempo, key and dynamic state on returns; marks in skipped endings do not leak into later playback. The interface displays written bar numbers while seeking and timing follow the expanded performance. Expansion is bounded to 10,000 bars and 200,000 notes. Ordinary tied notes become one sustained event across adjacent played bars. Invalid ties play separately with warnings.

Static dynamics persist within each part across bars and rests, using saved playback velocities when available and the marking's standard level otherwise. Unmarked music defaults to mf. Accents strengthen the current dynamic; snare and bass drum accents receive an additional playback boost after velocity clamping. Staff-only dynamic scope is not distinguished.

### Sticking, rolls and flams

Sticking priority is explicit position-anchored R/L annotation, named drum mapping, configured staff-line mapping, then unspecified. Explicit annotations win conflicts and produce a warning. Unspecified hands remain neutral in the visuals and challenges; left/right sticking is never invented.

Snare roll marks `r8`, `r16` and `r32` share the same playback interpretation. The default `repertoire` profile uses semiquaver hand movements in simple time and quaver movements in compound /8 meters such as 6/8, 9/8 and 12/8. Simple 3/8 retains semiquaver spacing. `sixteenth` and `eighth` force their respective movement intervals; `disabled` leaves tremolos unexpanded and reported.

Rolls alternate from the known starting hand; unknown hands stay unspecified. Marked tied segments join before expansion, preserving phase across barlines without duplicate boundary attacks. A roll tied into an unmarked note ends with a separate release tap carrying that note's hand, accent and dynamic. A roll beginning inside a tie chain starts at its first marked segment. Meter changes within tied rolls preserve the initial movement interval and warn.

Audio generates four evenly spaced contacts per quaver independently of the hand-change profile. A single-slash semiquaver therefore produces one instructional movement with two same-hand contacts. Roll contacts use a uniform reduced dynamic level. Challenges judge instructional movements rather than every audio contact.

A single pre-note snare acciaccatura or appoggiatura becomes a flam: a quiet grace stroke precedes the main hit by 35 ms at normal speed, shortening in dense passages and scaling with practice speed. Each stroke retains its written hand; the main hit retains its beat, accent and dynamic. Grace strokes consume no metrical time. Opening grace strokes are included on playback, restart and challenge count-in.

### Interpretation limits

- D.C./D.S., Coda/Fine and measure-repeat symbols are not expanded.
- Grace notes other than supported single pre-note snare flams are omitted with diagnostics.
- Instrument changes, octave spanners and two-chord tremolos are reported but not interpreted; stored pitches remain the source.
- Compressed multimeasure rests, cross-measure voice locations and mid-bar time-signature changes have limited support and diagnostics.
- Hairpins, dynamics changing within held notes, special attacks such as sfz, other articulations, fermatas and swing are not interpreted.

Warnings remain available on the score/timeline models. The instrument views are instructional SVG representations, not sheet-music engraving or physical simulations.

## Catalogue and practice interface

Opening the bare URL shows a searchable home screen with no score selected. Pieces appear under **Drum solos** and **Full band pieces**, with descriptions below their titles. Solos use a drum icon and full band pieces a music note throughout the catalogue. Search matches titles, composers, descriptions and type labels.

Selecting a piece opens practice and updates the URL fragment to its encoded filename ID, for example `#colonel-bogey`. Browser Back/Forward restores selections, and the bare URL returns to the home screen. Invalid or unreadable links show an error while leaving other scores available. Desktop practice retains a searchable sidebar with the active score highlighted; mobile uses a **Change score** dialog.

The practice page has a compact piece heading, instrument view and control column. The visual panel heading shows a static part name for single-part scores and an instrument dropdown for scores with multiple parts. The selected visual part is independent of the audio mix, so it is possible to follow a muted part. The controls provide:

- Play/pause, restart, a slider that seeks to bar starts, and the current/total written bar count. Slider steps follow the expanded performance, keeping repeat passes separately reachable and respecting pickups and tempo changes. Beat numbers and timestamps are omitted.
- Tempo from 50–125%, presets of 50%, 60%, 80%, 90% and 100%, and the effective crotchet BPM. Speed changes timing without changing pitch.
- A metronome toggle that follows meter and tempo changes, accents downbeats and operates independently of the part mix.
- An audio mixer collapsed by default, with 0–100% volume and Mute/Solo controls for every part. Multiple solos play together; mute takes precedence. Opening or closing the mixer leaves playback running. Volume percentages appear on hover or focus.
- Available challenges below the audio controls, outside the instrument view.

Current and next played bars appear below the instrument as compact rhythm strips for a single note at a time per part. Each has a bare bar number on the left, numbered beats and lighter subdivision lines; time signatures are omitted. Note centres retain exact proportional musical positions through tempo changes. Labels stay stationary and use one level where they fit; crowded notes stagger into closely spaced rows without shifting sideways or shrinking text. Vertical placement has no pitch meaning. Every full bar remains visible without horizontal scrolling. Both bar slots have a fixed height, including silent bars and the end-of-score placeholder, so controls below stay stationary as note density changes. Active notes have a circular highlight behind the lettering, using the same pale blue as the selected tempo preset. Rests leave blank space, with Rest shown for a fully silent bar. Rolls/flams are labelled, and tied continuations say Hold. Pickups occupy their trailing fraction of a full bar; compound meters group dotted-crotchet beats. A playhead tracks playback. Pitch labels use sharps and distinguish octaves; tempo remains crotchet BPM.

Lyre beaters and drum sticks follow playback, pause with the transport and reproduce the same pose after seeking. Stick preparation reflects dynamics and accents; each hand recovers towards its next stroke, while rolls and flam grace strokes remain close to the head. The animation is deterministic and separate from audio scheduling and challenge judgement.

Controls support native keyboard interaction and touch targets. Mobile playback fits Play/Pause, Restart, bar slider and bar count into one row with 44-pixel-high interactive targets. Play/Pause uses an accessible icon button on phones. The row scrolls with the page so it does not obscure the instrument. Reduced motion retains highlights and labels, disables stick movement and animated beater travel, and leaves a stationary lyre cue above the next note.

## Audio and timing

Playback begins after a user action unlocks Web Audio. The transport schedules against the audio clock with a short lookahead. Snare animation, challenge cues and timestamped challenge inputs use an audible-output clock where reliable, falling back to the rendering clock with valid device-latency compensation. Invalid, stale or inconsistent output timestamps and negative or greater-than-two-second latency reports must not freeze progress.

Pause, seek, restart, speed changes and score changes cancel scheduled sources and clear snare reverb. Held pitched notes are restored when resuming or seeking into their duration. Missed scheduling windows after background delays do not replay old attacks in a burst. Suspended audio pauses practice and prompts the user to resume; interrupted challenges require a fresh attempt.

Per-part gain nodes apply volume, mute and solo immediately to current and scheduled audio. Practice continues scheduling muted notes so unmuting a held sound is immediate. Challenge mixes are fixed for the attempt and skip muted synthesis. Switching the practice metronome cancels only click voices and preserves instrument playback.

Bell lyre uses a procedural struck-metal voice, snare uses procedural noise and membrane resonance with a short room response, bass drum uses a decaying low sine, and other pitched parts use decaying triangle oscillators. Cymbals use a recorded marching hand-cymbal sample. The sample is loaded and decoded before playback starts, reused between hits and aligned so the main crash lands on the beat. Failure to load or decode is reported for retry.

Written lyre and cymbal note lengths control damping; ties produce one attack over the combined duration. Speed changes damping time without shifting pitch or stretching the sample. Live challenge taps use the natural decay, and quieter cymbal hits reduce gain and brightness. These are approximate practice sounds rather than MuseScore sound reproduction; a recorded cymbal cannot sustain beyond its available tail.

## Interactive challenges

Bell lyre and drum challenges replace the practice controls with dedicated instrument boards. Routes are `#<score-id>/challenge` and `#<score-id>/drum-challenge`, with browser history support. Only playable parts are offered: lyre targets must all fit the configured register; drum parts must be percussion with a snare renderer and playable movements. Direct links to unavailable challenges show an explanation and a return action.

Both modes share setup, count-in, progress, streaks, results, retry and interruption handling. Setup offers 25–150% speed, advance cues, metronome and selected-part backing. Defaults are 75% speed, cues on, and metronome/backing off. Challenge settings and mixes are independent of practice controls. A full-bar audible count-in follows the starting meter, including compound beats and pickup pieces. Count-in taps sound without judgement until the first expected attack, including an opening flam grace stroke.

| Behaviour | Bell lyre | Drum |
| --- | --- | --- |
| Input | Touch, mouse or keyboard activation of pitched bars; simultaneous fingers supported. | Left/right pads using separate touch pointers, mouse, F/J or focused button activation. Held keys do not repeat. |
| Advance cues | Bar outlines up to 0.8 seconds before an attack. | Falling bars with a two-second preview, matching left/right or a neutral Either lane. |
| Accompaniment | Percussion remains audible; other pitched parts are muted. | Other parts remain audible. |
| Selected part | Optional quieter automatic backing; every tap sounds its actual pitch independently. | Optional quieter drum backing; every tap sounds a snare strike independently. |

Cues off removes attack prompts while retaining player-input feedback. No haptics are used. Ties require one strike, repeated attacks remain separate, and duplicate voices at the same pitch/hand and onset need one physical strike. Chords and simultaneous opposite-hand drum targets accept separate fingers. Either drum pad can claim an unspecified-hand attack. A wrong-hand strike consumes the expected attack as a miss, cannot be corrected, and receives no additional extra-tap penalty. Both strokes of a flam are targets.

### Judgement and results

Input event timestamps are mapped to the same audio-output clock as the cues. Delayed event delivery can still receive credit for its original timestamp. Timing windows use real time at every speed and narrow to half the neighbouring onset gap in dense passages:

- Perfect: within the smaller of ±65 ms or 65% of the target window; credit 1.
- Close: within the smaller of ±100 ms or 80% of the window; credit 0.7.
- Remaining accepted early/late hits: within the window, at most ±150 ms; credit 0.3.
- Misses earn zero; wrong/extra taps deduct 0.25 points. A successful target cannot be claimed twice.

Stars equal the rounded result of `10 × (total hit credit − extra-tap penalties) / expected attacks`, clamped to 0–10. Assistance does not reduce the available stars; settings are shown with the result. Perfect hits display brief positive feedback. A streak counter appears after three consecutive perfect attacks, with visual tiers at 10, 20 and 30. Other judgements and misses break the streak without negative text during play. Results include the longest perfect streak.

All ten star outlines appear immediately, then earned stars fill sequentially with ascending chimes. Result sounds can be disabled; reduced motion removes pop/spark animations. Results exist only in memory and are cleared on retry, navigation or reload. Stop returns to setup with the chosen settings. Backgrounding or losing audio interrupts an attempt without awarding a partial result.

Challenge frames read the audio clock without rerendering React on every animation frame. React updates on meaningful cue/feedback changes; progress updates ten times per second. Indexed target lookup, incremental missed-note expiry and cached resize-aware drum geometry bound work during play.

## Verification and runtime constraints

The app requires HTTP hosting; opening `index.html` with `file://` is unsupported. Production consists of static assets in `dist/`, served without a Node.js runtime. Unknown asset paths return 404. See the [README](README.md#deployment) for build and deployment commands.

`npm run typecheck`, `npm test` and `npm run build` check types, notation/interpretation, transport, challenge logic and production packaging. `npm run ci:build` runs unit tests followed by the production build.

Playwright browser tests cover catalogue/history, responsive controls, real Web Audio output and cancellation, instrument visuals, and both challenge modes. Run `npx playwright install chromium` once, then `npm run test:e2e`; an installed Chrome can instead be used with `PLAYWRIGHT_CHANNEL=chrome`. `PLAYWRIGHT_BROWSER=firefox` or `webkit` selects an installed alternative engine. Tests start or reuse the local dev server unless `E2E_URL` points to an existing server or production preview. Results use the system temporary directory unless `PLAYWRIGHT_OUTPUT_DIR` is set.

Desktop and emulated mobile checks do not establish real iOS/Android touch or audio-latency behaviour. Physical instrument register, sound quality and device timing require direct verification.
