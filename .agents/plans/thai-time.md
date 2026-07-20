# Plan: Thai time (static page)

Single static page: current clock in Thailand’s historical/legal zone rules, **HHMM** (prefer Thai numerals e.g. `๒๒๐๐`; Latin e.g. `2200` if `thai` numbering unavailable), Thai six-hour script + bell on the hour. **Reason + Melange + ReasonReact.**

## Goal

Ship one static web page that:

1. Shows **only** the current time as **four digits** (24-hour **HHMM**, prefer Thai numerals e.g. `๒๒๐๐`; Latin e.g. `2200` if `numberingSystem: 'thai'` unavailable), nothing else on screen in the normal state.
2. Interprets “now” as the **visitor’s system clock instant** (`Date.now()`), formatted in **`Asia/Bangkok`** wall time via **`Intl.DateTimeFormat`** when available (IANA history + manual fallback — see below). If **`Intl` is missing entirely**, degrade to **Latin Unix timestamp** (seconds); no hourly announcement in that mode.
3. On each new hour, **announces** with bell chimes using the **Thai six-hour** count, and while announcing replaces **HHMM** with the Thai-script six-hour label (special cases below).

Out of scope for v1: date display, settings UI, timezone picker, second hand, localization toggles, server-side time.

## Project placement

New monorepo project: `thai-time/` (Reason + Melange + ReasonReact static app). Build output is static files only.

Plan lives here: `.agents/plans/thai-time.md`. Project-local notes later under `thai-time/` if needed.

## Timezone rules (`Intl` / IANA `Asia/Bangkok`)

Take the **system clock instant** (`Date.now()`), not network/API time. Use **`Intl.DateTimeFormat`** with **`timeZone: 'Asia/Bangkok'`** when it encodes IANA history. No `@formatjs` tz pack, no pre-1880 error path.

**No `Intl` (degrade mode):** if `Intl` / `DateTimeFormat` is unavailable, skip `Zone` / Bangkok wall time / announcements. Show **`Math.floor(Date.now() / 1000)`** as a Latin decimal string (Unix seconds), updated each tick. No bells, no Thai word labels.

IANA summary (tests + `bangkokWallManual` constants):

| Period (Bangkok wall) | Offset | Name |
|-----------------------|--------|------|
| Before 1880 | `UTC+06:42:04` | LMT |
| 1880-01-01 – 1920-03-31 23:59:59 | `UTC+06:42:04` | BMT |
| From 1920-04-01 00:17:56 (after +17:56 jump) | `UTC+07:00` | ICT |

Display **four digits** (24-hour **HHMM**, no colon) in Bangkok wall time (floor to minute; no seconds on screen). Prefer **Thai numerals** via **`Intl`** (`numberingSystem: 'thai'`); if that numbering system is unavailable, **Latin digits are acceptable** (e.g. `2200`). Keep hour/minute **integers** for logic on a separate **`latn`** formatter (see below).

### Zone resolution (Approach A)

Hand-roll fallback in **Reason inside `Zone.re`** — not a separate JS helper, not `@formatjs` / full IANA.

1. **Probe** (once, cache): format `1920-03-31T17:17:55Z` with fixed locale **`th-TH`**, `timeZone: 'Asia/Bangkok'`, **`hourCycle: 'h23'`**, **`numberingSystem: 'latn'`**, **`hour: '2-digit'`**, **`minute: '2-digit'`** only (no day/month/year/era). Expect wall hour **23**, minute **59** (ignore seconds). Treat as **failure** both when the call **throws** (e.g. missing zone) and when it returns the wrong hour/minute.
2. If probe **passes** → cached `Intl.DateTimeFormat` instances with the **same base options** (`th-TH`, `Asia/Bangkok`, `h23`, **`hour`/`minute`: `'2-digit'` only** — no date/era fields):  
   - **Logic:** `numberingSystem: 'latn'` — `formatToParts`; **parse** hour/minute part strings to **ints** (0–23 / 0–59) for triggers and `ThaiClock`.  
   - **Display numbering (once, cache):** try `numberingSystem: 'thai'`; if constructing/formatting **throws**, or hour/minute parts are not Thai digits (every character in **U+0E50–U+0E59**, ๐–๙), set display numbering to **`latn`**. Rare slim ICU without `thai` → Latin HHMM is OK.  
   - **Display:** `formatToParts` with the chosen numbering; concatenate **`hour` + `minute` parts only** (drop literals such as `:`), e.g. `๒๒` + `๐๐` → `๒๒๐๐` or `22` + `00` → `2200`. Do not parse Thai digit strings back to ints.
3. If probe **fails** → **`bangkokWallManual(utc_ms)`**:  
   - `offset_ms` = `+6:42:04` (`24_124_000` ms) when `utc_ms <` instant of `1920-03-31T17:17:56Z`, else `+7:00:00` (`25_200_000` ms).  
   - `wall_ms = utc_ms + offset_ms`.  
   - Read **hour and minute ints** from UTC getters on `new Date(wall_ms)` (`getUTCHours` / `getUTCMinutes`) — treat `wall_ms` as a synthetic UTC clock, **not** `toLocaleString` or the visitor’s local zone.  
   - **Display:** format those ints with the **same display formatter** as step 2 (chosen `thai` or `latn`; e.g. anchor `Date.UTC(1970, 0, 1, hour, minute)` + `timeZone: 'UTC'`); concatenate **hour + minute** parts → **HHMM** (no colon).

Logic tests compare **latn** `HH:MM` at minute precision (e.g. `1920-03-31T17:17:55Z` → `23:59`; `17:17:56Z` → `00:17`). UI tests assert **thai** HHMM when `thai` numbering works (e.g. `๒๒๐๐`); when forced to `latn` display, assert Latin HHMM (e.g. `2200`).

## Normal UI

- Full viewport, no chrome, no title text in the document body beyond the time (page `<title>` can be minimal, e.g. `thai-time`).
- One centered (or otherwise single) text node: four-digit **HHMM** (no colon; prefer Thai numerals via `numberingSystem: 'thai'`, e.g. `๐๙๐๕`; Latin `0905` if `thai` unavailable).
- Update at least every second (or on `visibilitychange`) so hour rollover is caught; display still minute precision only.
- No other visible widgets.

## On-the-hour announcement

### Trigger

When the Bangkok wall **hour int** from `Zone` logic advances to a new value with minute `00` (transition into `:00` while the page is open — **not** on first paint at `:00` after refresh). Use logic hour for triggers, not the display string (`๒๒๐๐` / `2200`). **Disabled in degrade mode** (no `Intl`). If the tab was backgrounded across an hour boundary, announce once on next visible tick for the **current** hour (see overlap rules below).

### Overlap and missed hours

- **At most one announce sequence** at a time (label + chime queue).  
- **Hour changes during announce:** **supersede** — stop in-flight chimes, run the **new** hour’s label + chime count.  
- **Tab backgrounded across one or more hours:** on `visibilitychange` → visible, if `lastAnnouncedHour ≠ currentHour`, announce **current** hour only (not every skipped hour).  
- **Refresh at `:00`:** do not announce (no transition from a prior open-session hour).

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

Digits in labels: use Thai script numerals if we spell with numerals (หนึ่ง/สอง/… as above is fine; stay consistent — prefer the spelled forms in the table).

### During announcement (UI)

- Replace **HHMM** with the Thai **word** label for that hour (full string; no Latin digits).
- Keep that label visible for the duration of the chime sequence (and a short tail, e.g. until chimes finish + ~1s), then revert to **HHMM**.
- Still “nothing else”: only the label text swaps; no extra caption.

### Audio

- One short bell sample (static asset under `thai-time/`), played **N** times with a fixed gap.
- Respect browser autoplay policy: first chime may require a prior user gesture; document that a click/tap anywhere arms audio if needed (arming gesture should not add visible chrome — listen on `window`).
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
| OCaml | **opam** + **Dune** | `melange`, `reason`, `reason-react`, compile `.re` → JS under `_build/` |
| JS | **npm** | `react`, `react-dom`, bundler, test runner |

Dune alone is not enough for a ReasonReact browser app (React runtime comes from npm). Melange does not replace a bundler.

### Build / serve

- **Vite** — default bundler + dev server (matches Melange/ReasonReact templates). Entry is Melange emit output under `_build/…` plus `index.html`.
- Production: Vite → static `dist/`. No backend.
- **esbuild**-only is an acceptable thinner alternative; do not use webpack unless copying an old template.

### Tests

- **Jest** + **`melange-jest`** (opam bindings; `jest` on npm) for Melange-compiled unit tests.
- Pure modules (`ThaiClock`, `Zone`) tested this way; optional UI later via `melange-testing-library` + Jest.
- `Intl` / zone tests must run in JS (Node), not native Alcotest.
- Do **not** use Vitest (no first-class Melange path).

### App modules

- `Zone.re` — Approach A: probe + `Intl` logic (`latn`) / display (`thai`, else `latn`) + `bangkokWallManual`
- `ThaiClock.re` — hour → display label and chime count (separate)
- `App.re` — tick, announce state machine, render one string
- `Bell.re` / audio helper — play N chimes

## Acceptance checks

- [ ] At a normal modern system time: shows ICT time as four digits only (prefer `๒๒๐๐` at Bangkok 22:00; `2200` OK if `thai` numbering unavailable).
- [ ] System date forced into 1880–1920-03-31: wall time matches BMT (`UTC+06:42:04`; ~18 minutes behind ICT at the same instant) via `Intl` or `bangkokWallManual`.
- [ ] Fixture `1920-03-31T17:17:55Z` → `23:59` BMT; `1920-03-31T17:17:56Z` → `00:17` ICT (IANA transition; minute precision).
- [ ] When `Intl` fails the BMT probe, `bangkokWallManual` still passes the fixtures above.
- [ ] On hour change to 22:00: label **สี่ทุ่ม**, **4** bell plays; then back to **`๒๒๐๐`** (or **`2200`** if Latin display).
- [ ] At 00 / 06 / 12: mandated display strings, **6** chimes each.
- [ ] 06/16/17/18/00 use the mandated Thai display strings (not the rejected forms).
- [ ] Static deploy: open `index.html` (or static host) with no server logic.

## Implementation order

1. Scaffold `thai-time/`: opam (Melange + ReasonReact) + npm (`react`, `react-dom`, Vite, Jest).
2. Pure `ThaiClock` mapping + Jest/`melange-jest` tests: for each hour **0–23**, assert `displayLabel` / `chimeCount` match the table; for hours **0, 6, 16, 17, 18** assert labels are **not** the forbidden alternatives listed under “Required wording” (e.g. hour 6 ≠ `ตีหก`, hour 16 ≠ `บ่ายสี่โมง`).
3. `Zone`: Approach A (`Intl` + BMT probe + `bangkokWallManual` + display numbering `thai`/`latn`). Jest tests:  
   - **Zone:** fixture UTC instants → latn logic `HH:MM` + hour int (incl. `1920-03-31T17:17:55Z` / `17:17:56Z`); **forced `bangkokWallManual`** when BMT probe is stubbed to fail.  
   - **Display:** when `thai` numbering works → Thai HHMM (e.g. `๒๒๐๐`); **forced `latn` display** (stub `thai` construct/format failure or non-Thai digit parts) → Latin HHMM (e.g. `2200`). Same chosen display formatter on manual path.
4. UI tick + announce state machine; add bell asset; wire audio; Vite static build.
5. Manual check with devtools clock spoofing / injected `now` for era and hour-boundary tests.
