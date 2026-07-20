# Plan: Thai time (static page)

Single static page: current clock in Thailand’s historical/legal zone rules, **HHMM** (prefer Thai numerals e.g. `๒๒๐๐`; Latin e.g. `2200` if `thai` numbering unavailable), Thai six-hour label on the hour (bell when armed); **degrade** to Latin Unix seconds if `Intl` / `DateTimeFormat` is unusable (see Degrade gate). **Reason + Melange + ReasonReact.**

## Goal

Ship one static web page that:

1. Shows **only** the current time on screen: in the normal path, **four-digit HHMM** (prefer Thai numerals e.g. `๒๒๐๐`; Latin e.g. `2200` if `numberingSystem: 'thai'` unavailable); in **degrade mode** (`Intl` / `DateTimeFormat` unusable — see Degrade gate), a **Latin Unix-seconds** decimal string instead (not HHMM). Nothing else on screen either way.
2. Interprets “now” as the **visitor’s system clock instant** (`Date.now()`), as **Bangkok wall time** when **`DateTimeFormat` is usable** (probe **A** → `Asia/Bangkok` via `Intl`; if **A** fails → **`bangkokWallManual`**; display numbering via probe **B** — see Zone resolution). If **`Intl` / `DateTimeFormat` is unusable**, degrade to **Latin Unix timestamp** (seconds); no hourly announcement in that mode.
3. On each new hour (**normal path only** — **not** in degrade mode), **announces** with the Thai-script six-hour label (special cases below) and bell chimes **when audio is armed** (silent label-only announce if unarmed — see During announcement).

Out of scope for v1: date display, settings UI, timezone picker, second hand, localization toggles, server-side time.

## Project placement

New monorepo project: `thai-time/` (Reason + Melange + ReasonReact static app). Build output is static files only.

Plan lives here: `.agents/plans/thai-time.md`. Project-local notes later under `thai-time/` if needed.

## Timezone rules (`Intl` / IANA `Asia/Bangkok`)

Take the **system clock instant** (`Date.now()`), not network/API time. When **`DateTimeFormat` is usable** (see Degrade gate), prefer **`Asia/Bangkok`** via `Intl` if BMT history probe **A** passes; if **A** fails, use **`bangkokWallManual`** for wall hour/minute. Display numbering always via probe **B** on the normal path (see Zone resolution). No `@formatjs` tz pack, no pre-1880 error path.

### Degrade gate

**Degrade mode** when any of:

- `Intl` is missing, or
- `Intl.DateTimeFormat` is missing, or
- a **required** `DateTimeFormat` **throws** on construct or on `format` / `formatToParts` — init smoke, logic/`latn` display, or tick (not a `numberingSystem: 'thai'`-only failure; see probe **B**).

**Init smoke + catch throws for the session:** at init, run a minimal formatter smoke test (e.g. `th-TH`, `timeZone: 'UTC'`, `hour`/`minute` `'2-digit'` only, **`numberingSystem: 'latn'`**). If that fails (missing or throws) → degrade. On the normal path, if a later required `DateTimeFormat` call throws (probes **A**/`latn` **B**, or tick) → switch to degrade for the rest of the session. **`App` does not call `Zone` or announce** in degrade mode. Show **`Math.floor(Date.now() / 1000)`** as a Latin decimal string (Unix seconds), updated each tick. No bells, no Thai word labels.

**Mid-announce throw:** if a required `DateTimeFormat` throws while an announce is in progress, **cancel** pending gap timers, **`POST_CHIME_TAIL_MS`**, and audio (same cleanup as supersede abort), then enter degrade for the session.

Probe **A** / **B** **failures** without throwing (wrong hour, bad Thai digits, empty parts) are **not** degrade — they select `bangkokWallManual` or `latn` display. A throw constructing/formatting **`numberingSystem: 'thai'`** alone is **not** degrade — fall back to **`latn`** (see **B**).

IANA summary (tests + `bangkokWallManual` constants):

| Period (Bangkok wall) | Offset | Name |
|-----------------------|--------|------|
| Before 1880 | `UTC+06:42:04` | LMT |
| 1880-01-01 – 1920-03-31 23:59:59 | `UTC+06:42:04` | BMT |
| From 1920-04-01 00:17:56 (after +17:56 jump) | `UTC+07:00` | ICT |

Display **four digits** (24-hour **HHMM**, no colon) in Bangkok wall time (floor to minute; no seconds on screen). Prefer **Thai numerals** via **`Intl`** (`numberingSystem: 'thai'`); if that numbering system is unavailable, **Latin digits are acceptable** (e.g. `2200`). Keep hour/minute **integers** for logic on a separate **`latn`** formatter (see below).

### Zone resolution (Approach A)

Hand-roll fallback in **Reason inside `Zone.re`** — not a separate JS helper, not `@formatjs` / full IANA.

Whenever **`DateTimeFormat` is usable** (normal path, not degrade), run **A then B** once each and cache. **Display-numbering (B) does not depend on BMT history (A) success.**

**A. BMT history probe** — format `1920-03-31T17:17:55Z` with fixed locale **`th-TH`**, `timeZone: 'Asia/Bangkok'`, **`hourCycle: 'h23'`**, **`numberingSystem: 'latn'`**, **`hour: '2-digit'`**, **`minute: '2-digit'`** only (no day/month/year/era). Expect wall hour **23**, minute **59** (ignore seconds). Wrong hour/minute → **A** fails → `bangkokWallManual`. **`DateTimeFormat` throws** → **Degrade gate** (not **A** fail).

**B. Display-numbering probe** (always on the normal path — even if **A** failed; run **after A**): base options `th-TH`, `h23`, **`hour`/`minute`: `'2-digit'` only**. Uses **fixed probe instants** (not `now` / not the visitor’s spoofed system date). Try `numberingSystem: 'thai'` on **`2026-07-20T15:00:00Z`** (Bangkok **22:00** ICT; use `timeZone: 'Asia/Bangkok'` if **A** passed, else `timeZone: 'UTC'` on `Date.UTC(1970, 0, 1, 22, 0)`). Prefer **`thai`** when hour/minute parts are non-empty and every character is in **U+0E50–U+0E59** (expect **`๒๒`** / **`๐๐`**). If **`thai` construct/format throws**, or parts are empty/non-Thai digits, set display numbering to **`latn`** (Latin HHMM is OK). If constructing/formatting the **`latn`** display formatter **throws** → **Degrade gate** (not a soft `latn` choice).

Then wall time:

1. If **A** **passes** → cached logic formatter (`Asia/Bangkok`, `latn`, same base options): `formatToParts`; **parse** hour/minute part strings to **ints** (0–23 / 0–59) for triggers and `ThaiClock`. Display: `formatToParts` with the numbering from **B**; concatenate **`hour` + `minute` parts only** (drop literals), e.g. `๒๒๐๐` / `2200`. Do not parse Thai digit strings back to ints.
2. If **A** **fails** → **`bangkokWallManual(utc_ms)`**:  
   - `offset_ms` = `+6:42:04` (`24_124_000` ms) when `utc_ms <` instant of `1920-03-31T17:17:56Z`, else `+7:00:00` (`25_200_000` ms).  
   - `wall_ms = utc_ms + offset_ms`.  
   - Read **hour and minute ints** from UTC getters on `new Date(wall_ms)` (`getUTCHours` / `getUTCMinutes`) — treat `wall_ms` as a synthetic UTC clock, **not** `toLocaleString` or the visitor’s local zone.  
   - **Display:** format those ints with the **display formatter from B** (chosen `thai` or `latn`; e.g. anchor `Date.UTC(1970, 0, 1, hour, minute)` + `timeZone: 'UTC'`); concatenate **hour + minute** parts → **HHMM** (no colon).

Logic tests compare **latn** `HH:MM` at minute precision (e.g. `1920-03-31T17:17:55Z` → `23:59`; `17:17:56Z` → `00:17`). UI tests assert **thai** HHMM when `thai` numbering works (e.g. `๒๒๐๐`); when forced to `latn` display, assert Latin HHMM (e.g. `2200`).

## Normal UI

- Full viewport, no chrome, no title text in the document body beyond the time (page `<title>` can be minimal, e.g. `thai-time`; **`html lang="th"`**).
- **Layout:** viewport-centered (`min-height: 100vh`, flex or grid center); system font stack (no custom webfont in v1).
  - **HHMM:** single line; `font-size: clamp(3rem, 20vmin, 12rem)`; `white-space: nowrap`.
  - **Announce labels:** may be longer than HHMM — allow wrap (`white-space: normal`) and/or a slightly smaller clamp so long strings (e.g. `หนึ่งโมงเช้า`) stay on-screen on narrow viewports; do not clip with `nowrap` + huge type.
- One centered text node; layout class is one of **`clock`** | **`announce`** | **`degrade`** (same element, different CSS):
  - **`clock`** — normal HHMM (four digits, no colon; prefer Thai numerals via `numberingSystem: 'thai'`, e.g. `๐๙๐๕`; Latin `0905` if `thai` unavailable). Uses HHMM typography (`nowrap` + large clamp).
  - **`announce`** — Thai word label during announce (wrap / smaller clamp as above).
  - **`degrade`** — Latin Unix seconds (`Math.floor(Date.now() / 1000)`); **not** announce typography (same or near-`clock` sizing is fine; do not use `announce` styles).
- Update at least every second (or on `visibilitychange`) so hour rollover is caught; normal path still minute precision on screen.
- No other visible widgets.

## On-the-hour announcement

### Trigger

When the Bangkok wall **hour int** from `Zone` logic advances to a new value with minute `00` (transition into `:00` while the page is open — **not** on first paint at `:00` after refresh). Use logic hour for triggers, not the display string (`๒๒๐๐` / `2200`). **Disabled in degrade mode**. Update **`lastAnnouncedHour`** per **Overlap** (on sequence complete; on **supersede**, only the replacement sequence). If the tab was backgrounded across an hour boundary, see overlap rules (announce **only on the hour** when becoming visible).

### Overlap and missed hours

- **Init:** on first paint (normal path), set `lastAnnouncedHour` to the **current** Bangkok hour **without** announcing — so refresh / first load never chimes, including at `:00`.
- **After any announce:** set `lastAnnouncedHour = currentHour` when the sequence **completes** (foreground `:00` transition, background return on the hour, or **silent** label-only announce — audio optional). On **supersede**, only the **replacement** sequence’s completion updates `lastAnnouncedHour` — the aborted hour does not. Counts as “announced” even if `Bell` no-oped.
- **At most one announce sequence** at a time (label + chime queue).  
- **Hour changes during announce:** **supersede** — **cancel** in-flight chime timers/audio **and** any pending **`POST_CHIME_TAIL_MS`** (including during a **silent** announce — tail timer alone must not revert to HHMM mid–new-announce), then run the **new** hour’s label + chime count from chime **1** with a fresh `CHIME_GAP_MS` schedule (see Audio).  
- **Tab backgrounded across one or more hours:** on `visibilitychange` → visible, announce **only if `minute === 0`** and `lastAnnouncedHour ≠ currentHour` (current hour’s label + chimes). Set **`lastAnnouncedHour = currentHour` when that sequence completes** (same as “After any announce”; audible or silent). If visible but not on the hour (e.g. `:30`), **do not** announce — wait for the normal foreground `:00` trigger. Missed `:00` while hidden are not replayed retroactively.  
- **Refresh at `:00`:** do not announce (covered by init; no transition from a prior open-session hour).

### Chime count (Thai six-hour)

Chime **N** times where **N** is the Thai six-hour hour index (1–6 within each six-hour block) — **not** the 24-hour number and not 12-hour.

**Display label and chime count are independent.** `ThaiClock.displayLabel(hour)` and `ThaiClock.chimeCount(hour)` are separate. Pivots at 00 / 06 / 12 use preferred display wording but still chime **6** (six-hour position หกทุ่ม / end of ตี block / end of morning block).

Reference (user): **22:00 → 4 chimes** (สี่ทุ่ม).

| Bangkok hour | Label (display during announce) | Chimes |
|-------------:|---------------------------------|-------:|
| 00 | เที่ยงคืน | 6 |
| 01 | ตีหนึ่ง | 1 |
| 02 | ตีสอง | 2 |
| 03 | ตีสาม | 3 |
| 04 | ตีสี่ | 4 |
| 05 | ตีห้า | 5 |
| 06 | ย่ำรุ่ง | 6 |
| 07 | หนึ่งโมงเช้า | 1 |
| 08 | สองโมงเช้า | 2 |
| 09 | สามโมงเช้า | 3 |
| 10 | สี่โมงเช้า | 4 |
| 11 | ห้าโมงเช้า | 5 |
| 12 | เที่ยงวัน | 6 |
| 13 | บ่ายโมง | 1 |
| 14 | บ่ายสองโมง | 2 |
| 15 | บ่ายสามโมง | 3 |
| 16 | สี่โมงเย็น | 4 |
| 17 | ห้าโมงเย็น | 5 |
| 18 | หกโมงเย็น | 6 |
| 19 | หนึ่งทุ่ม | 1 |
| 20 | สองทุ่ม | 2 |
| 21 | สามทุ่ม | 3 |
| 22 | สี่ทุ่ม | 4 |
| 23 | ห้าทุ่ม | 5 |

**Required wording (override common alternatives):**

- 06:00 → **ย่ำรุ่ง** (not ตีหก)
- 16:00 → **สี่โมงเย็น** (not บ่ายสี่โมง)
- 17:00 → **ห้าโมงเย็น** (not บ่ายห้าโมง)
- 18:00 → **หกโมงเย็น** (not ย่ำค่ำ)
- 00:00 → **เที่ยงคืน** on screen (not หกทุ่ม / สองยาม); still **6** chimes (หกทุ่ม position)

Labels in the table use **spelled Thai words** (หนึ่ง/สอง/…), not Thai or Latin digits.

### During announcement (UI)

- Replace **HHMM** with the Thai **word** label for that hour (full string; spelled Thai words only — no Thai or Latin digits); class → **`announce`**.
- Keep that label visible for the duration of the chime sequence and **post-chime tail** (`POST_CHIME_TAIL_MS`, see Audio), then revert to **HHMM** / **`clock`**.
- **Label is independent of audio:** if bells are blocked (autoplay / not yet armed), still show the word label for the full announce window (silent announce). **Unarmed duration:** **`N * CHIME_GAP_MS + POST_CHIME_TAIL_MS`** from announce start (`N` = chime count for that hour). Arming later does not require re-triggering the label.
- Still “nothing else”: only the label text swaps; no extra caption.

### Audio

- One short bell sample (`thai-time/assets/bell.mp3` or `.wav`), played **N** times. Sample duration must be **shorter than** `CHIME_GAP_MS` so chimes never overlap.
- **License:** source a bell in order: (1) **search online** for **free/libre** or **public-domain** sample; (2) only if none suitable, **AI-generate** one. No proprietary stock. Record provenance in `thai-time/assets/` (e.g. short `NOTICE` or URL + license) at scaffold time.
- **Timing constants** in `Bell.re` (tune in impl; test with injected clock where needed):
  - `CHIME_GAP_MS` = **800** — delay from **previous chime start** to **next chime start** (not “after end”). Keep the asset < 800ms, or raise the constant.
  - `POST_CHIME_TAIL_MS` = **1000** — keep announce label visible after the last chime **ends**, then revert to HHMM. If unarmed, tail starts after **`N * CHIME_GAP_MS`** (scheduled silent chime window).
- **Supersede:** `Bell.re` / `App.re` must clear pending **gap** timers, pending **`POST_CHIME_TAIL_MS`** (whether or not any chime audio played), and stop the current sample before starting the replacement sequence (no carry-over delay or late HHMM revert from the aborted hour).
- Respect browser autoplay policy: first chime may require a prior user gesture; document that a click/tap anywhere arms audio if needed (arming gesture should not add visible chrome — listen on `window`). Unarmed → silent label-only announce (see During announcement).
- No speech synthesis in v1 (bells only).

## Stack

Locked language / UI:

- **Reason** syntax (`.re`)
- **Melange** (OCaml/Reason → JS via Dune `melange.emit`)
- **ReasonReact** (`reason-react` + `reason-react-ppx` via opam)

Not ReScript / `@rescript/react`. Not Vitest.

### Two package managers (both required)

| Side | Tool | Provides |
|------|------|----------|
| OCaml | **opam** + **Dune** | `melange`, `reason`, `reason-react`, `reason-react-ppx`, `melange-jest`; compile `.re` → JS under `_build/` |
| JS | **npm** | `react`, `react-dom`, **Vite**, **Jest** |

Dune alone is not enough for a ReasonReact browser app (React runtime comes from npm). Melange does not replace a bundler.

### Build / serve

- **Vite** — default bundler + dev server. Point at Melange **ESM** emit under `_build/default/thai-time/` (or project emit target) plus `index.html`. Start from [melange-vite-template](https://github.com/pdelacroix/melange-vite-template) or [melange-opam-template](https://github.com/melange-re/melange-opam-template) and trim.
- Production: Vite → static `dist/`. No backend.
- **esbuild**-only is an acceptable thinner alternative; do not use webpack unless copying an old template.

**Dual `melange.emit` (required):**

| Target | `module_system` | Purpose |
|--------|-----------------|--------|
| App (`thai-time` or `app`) | **es6** (default) | Vite browser bundle |
| Tests (`test` / `jest`) | **commonjs** | Jest via `melange-jest` (avoids `Cannot use import statement outside a module`) |

Separate `dune` aliases (e.g. `@melange` / `@jest`). Jest `rootDir` → test emit output under `_build/`.

**Static assets (Dune):** `index.html` at project root; bell under `assets/`. Use Melange **`runtime_deps`** / Dune **`copy_files#`** (or `data_only_dirs`) so `index.html` and `assets/bell.*` land beside emitted JS in `_build/…` for Vite.

### Tests

- **Jest** + **`melange-jest`** (opam bindings; `jest` on npm) for Melange-compiled unit tests — **CommonJS** test emit (see Build).
- Pure modules (`ThaiClock`, `Zone`) and **`App` announce FSM** tested this way; optional UI later via `melange-testing-library` + Jest.
- `Intl` / zone tests must run in JS (Node), not native Alcotest.
- Do **not** use Vitest (no first-class Melange path).
- **`Zone` / `App` test seams** (injectable, defaults = production behavior):
  - `now: unit => float` — ms since epoch; default `Js.Date.now` / `Date.now`.
  - **Degrade override** — force degrade on/off, or inject a throwing `DateTimeFormat` (missing / throw on construct or format).
  - **Probe overrides** for A/B — e.g. force BMT history **fail** / **pass**, force display numbering **`thai`** / **`latn`** (or inject fake `formatToParts` results). Do **not** rely only on mutating global `Intl` if a seam is cleaner; tests that stub **A** fail must still run **B**.

### App modules

- `Zone.re` — Approach A: **BMT probe (A)** + **display-numbering probe (B, normal path only)** + logic `Intl`/`bangkokWallManual`; **`now` + probe seams** for tests; not used when degrade gate fails
- `ThaiClock.re` — hour → display label and chime count (separate)
- `App.re` — run **Degrade gate** at init (smoke + session throw catch); if unusable, render **`degrade`** (Unix seconds) and **do not** call `Zone` or announce; on runtime **required** `DateTimeFormat` throw (including mid-announce), **cancel** announce timers/audio then switch to degrade for the session; otherwise tick, announce state machine, render one string (`clock` / `announce` only); passes `now` into `Zone`; label timing independent of audio arming
- `Bell.re` — play N chimes (`CHIME_GAP_MS`, `POST_CHIME_TAIL_MS`); no-op sound when unarmed

## Acceptance checks

- [ ] At a normal modern system time: shows ICT time as four digits only, **no colon** anywhere in HHMM (prefer `๒๒๐๐` at Bangkok 22:00; `2200` OK if `thai` numbering unavailable).
- [ ] System date forced into 1880–1920-03-31: wall time matches BMT (`UTC+06:42:04`; ~18 minutes behind ICT at the same instant) via `Intl` or `bangkokWallManual`.
- [ ] Fixture `1920-03-31T17:17:55Z` → `23:59` BMT; `1920-03-31T17:17:56Z` → `00:17` ICT (IANA transition; minute precision).
- [ ] When `Intl` fails the BMT probe, `bangkokWallManual` still passes the fixtures above; display HHMM still works via probe **B**.
- [ ] On hour change to 22:00: label **สี่ทุ่ม**, **4** bell plays (if armed); then back to **`๒๒๐๐`** (or **`2200`** if Latin display).
- [ ] At 00 / 06 / 12: mandated display strings, **6** chimes each (if armed).
- [ ] 06/16/17/18/00 use the mandated Thai display strings (not the rejected forms).
- [ ] Every `displayLabel` string uses spelled Thai words only — **no** Thai (U+0E50–U+0E59) or Latin (`0`–`9`) digits.
- [ ] First load or refresh at Bangkok `:00`: shows HHMM only — **no** announce (`lastAnnouncedHour` init, no chime).
- [ ] When `Intl` / `DateTimeFormat` is unusable (missing or **required** formatter throws): Latin Unix seconds only; class **`degrade`**; no bells or Thai labels. A **`thai`-only** throw still shows Latin HHMM (not degrade).
- [ ] Mid-announce **required** `DateTimeFormat` throw: announce timers/audio cancelled; then **`degrade`** for the session.
- [ ] Background return at `:30` with a missed hour: **no** announce; at `:00` with `lastAnnouncedHour ≠ currentHour`: announce current hour only.
- [ ] Supersede mid-announce (audible or **silent** tail pending): aborted hour’s **`POST_CHIME_TAIL_MS`** does not revert to HHMM during the new sequence; only the **new** sequence’s completion updates `lastAnnouncedHour`.
- [ ] Audio unarmed: word label still shows for chime+tail duration; no error UI.
- [ ] Bell asset: free/libre or public-domain preferred (search first); AI-generated only as fallback; provenance noted.
- [ ] Static deploy: open `index.html` (or static host) with no server logic; root element has **`lang="th"`**.

## Implementation order

1. Scaffold `thai-time/` from a Melange + ReasonReact template:
   - **opam:** `thai-time.opam` (local switch); `dune-project` with `(using melange …)`; deps `melange`, `reason`, `reason-react`, `reason-react-ppx`, `melange-jest`.
   - **dune:** `melange.emit` + `(preprocess (pps reason-react-ppx))`; **two emits** — ESM app + CJS Jest (see Build).
   - **npm:** `react`, `react-dom`, `vite`, `jest`; Vite config → `_build/…` app emit.
   - **assets:** `index.html` with **`<html lang="th">`**, `assets/bell.*` (free/libre or public-domain bell from web search first; AI-generated only if needed + provenance) via `runtime_deps` / `copy_files#`.
2. Pure `ThaiClock` mapping + Jest/`melange-jest` tests: for each hour **0–23**, assert `displayLabel` / `chimeCount` match the table; for hours **0, 6, 16, 17, 18** assert labels are **not** the forbidden alternatives listed under “Required wording” (e.g. hour 6 ≠ `ตีหก`, hour 16 ≠ `บ่ายสี่โมง`).
3. `Zone`: Approach A (**A** BMT history + **B** display numbering on normal path + `bangkokWallManual`); **`now` + probe seams**. Jest tests:  
   - **Zone:** fixture UTC instants → latn logic `HH:MM` + hour int (incl. `1920-03-31T17:17:55Z` / `17:17:56Z`); **forced `bangkokWallManual`** via probe-**A** seam — **B** still runs; display HHMM still works.  
   - **Display:** probe **B** → `๒๒`/`๐๐` when `thai` works; Thai HHMM `๒๒๐๐`; **forced `latn` display** via probe-**B** seam → `2200`. Manual path uses formatter from **B**.
   - **Degrade:** `DateTimeFormat` missing or throwing → `App` does not call `Zone`; Unix seconds + **`degrade`** class.
4. UI tick + announce state machine (`clock` / `announce` / `degrade`); wire `Bell.re` + licensed/AI bell asset; Vite static build. **Jest/`melange-jest` tests for `App` announce FSM** (injectable `now`; fake timers as needed): init — no announce on first paint (incl. Bangkok `:00`); foreground `:00` hour transition triggers announce; background return at `:00` vs `:30`; supersede mid-announce; unarmed silent label duration; **degrade gate** (missing / throwing `DateTimeFormat`).
5. Manual era / hour-boundary checks via **injected `now`** (devtools spoof optional).
