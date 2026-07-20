# Plan: Thai time (static page)

Single static page: current clock in Thailand’s historical/legal zone rules, HH:MM most of the time, Thai six-hour script + bell on the hour. **Reason + Melange + ReasonReact.**

## Goal

Ship one static web page that:

1. Shows **only** the current time as `HH:MM` (24-hour), nothing else on screen in the normal state.
2. Interprets “now” as the **visitor’s system clock instant** (`Date.now()`), formatted in **`Asia/Bangkok`** wall time via **`Intl.DateTimeFormat`** when it has IANA history, with a **Bangkok-only manual fallback** in `Zone.re` otherwise (see below). The **`Intl` API is required** — no support for runtimes without `Intl` at all.
3. On each new hour, **announces** with bell chimes using the **Thai six-hour** count, and while announcing replaces `HH:MM` with the Thai-script six-hour label (special cases below).

Out of scope for v1: date display, settings UI, timezone picker, second hand, localization toggles, server-side time.

## Project placement

New monorepo project: `thai-time/` (Reason + Melange + ReasonReact static app). Build output is static files only.

Plan lives here: `.agents/plans/thai-time.md`. Project-local notes later under `thai-time/` if needed.

## Timezone rules (`Intl` / IANA `Asia/Bangkok`)

Take the **system clock instant** (`Date.now()`), not network/API time. Use **`Intl.DateTimeFormat`** with **`timeZone: 'Asia/Bangkok'`** when it encodes IANA history. No `@formatjs` tz pack, no pre-1880 error path. Runtimes **without the `Intl` API** are unsupported.

IANA summary (tests + `bangkokWallManual` constants):

| Period (Bangkok wall) | Offset | Name |
|-----------------------|--------|------|
| Before 1880 | `UTC+06:42:04` | LMT |
| 1880-01-01 – 1920-03-31 23:59:59 | `UTC+06:42:04` | BMT |
| From 1920-04-01 00:17:56 (after +17:56 jump) | `UTC+07:00` | ICT |

Display `HH:MM` in Bangkok wall time (floor to minute; no seconds on screen).

### Zone resolution (Approach A)

Hand-roll fallback in **Reason inside `Zone.re`** — not a separate JS helper, not `@formatjs` / full IANA.

1. **Probe** (once, cache): format `1920-03-31T17:17:55Z` with `Intl` `Asia/Bangkok`; expect wall hour **23**, minute **59** (ignore seconds).
2. If probe **passes** → use `Intl` (`formatToParts`; **hour and minute parts only**, ignore `second`).
3. If probe **fails** → **`bangkokWallManual(utc_ms)`**:  
   - `offset_ms` = `+6:42:04` (`24_124_000` ms) when `utc_ms <` instant of `1920-03-31T17:17:56Z`, else `+7:00:00` (`25_200_000` ms).  
   - `wall_ms = utc_ms + offset_ms`.  
   - Read **hour and minute from UTC getters** on `new Date(wall_ms)` (`getUTCHours` / `getUTCMinutes`) — treat `wall_ms` as a synthetic UTC clock, **not** `toLocaleString` or the visitor’s local zone.

Tests compare `HH:MM` at minute precision (e.g. `1920-03-31T17:17:55Z` → `23:59`; `17:17:56Z` → `00:17`).

## Normal UI

- Full viewport, no chrome, no title text in the document body beyond the time (page `<title>` can be minimal, e.g. `thai-time`).
- One centered (or otherwise single) text node: `HH:MM` zero-padded.
- Update at least every second (or on `visibilitychange`) so hour rollover is caught; display still minute precision only.
- No other visible widgets.

## On-the-hour announcement

### Trigger

When the displayed zone’s hour advances (minute rolls to `00`, or first paint already at `:00` — **do not** re-announce on refresh at `:00` if we can avoid annoyance: announce only on **transition into** `:00` while the page is open). If the tab was backgrounded across the hour, announce on next visible tick if the hour boundary was crossed while hidden (optional; prefer yes so a backgrounded tab still chimes once when noticed).

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

- Replace `HH:MM` with the Thai label string for that hour (full string, no Latin digits).
- Keep that label visible for the duration of the chime sequence (and a short tail, e.g. until chimes finish + ~1s), then revert to `HH:MM`.
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

- `Zone.re` — Approach A: `Intl` `Asia/Bangkok` + probe + `bangkokWallManual` (UTC getters on shifted ms)
- `ThaiClock.re` — hour → display label and chime count (separate)
- `App.re` — tick, announce state machine, render one string
- `Bell.re` / audio helper — play N chimes

## Acceptance checks

- [ ] At a normal modern system time: shows ICT `HH:MM` only (`Intl` `Asia/Bangkok`).
- [ ] System date forced into 1880–1920-03-31: wall time matches BMT (`UTC+06:42:04`; ~18 minutes behind ICT at the same instant) via `Intl` or `bangkokWallManual`.
- [ ] Fixture `1920-03-31T17:17:55Z` → `23:59` BMT; `1920-03-31T17:17:56Z` → `00:17` ICT (IANA transition; minute precision).
- [ ] When `Intl` fails the BMT probe, `bangkokWallManual` still passes the fixtures above.
- [ ] On hour change to 22:00: label **สี่ทุ่ม**, **4** bell plays; then back to `22:00`.
- [ ] At 00 / 06 / 12: mandated display strings, **6** chimes each.
- [ ] 06/16/17/18/00 use the mandated Thai display strings (not the rejected forms).
- [ ] Static deploy: open `index.html` (or static host) with no server logic.

## Implementation order

1. Scaffold `thai-time/`: opam (Melange + ReasonReact) + npm (`react`, `react-dom`, Vite, Jest).
2. Pure `ThaiClock` mapping + Jest/`melange-jest` tests for all 24 hours (display labels + chime counts + forbidden display strings).
3. `Zone`: Approach A (`Intl` + probe + `bangkokWallManual`); Jest tests for fixtures (including forced-fallback).
4. UI tick + announce state machine; add bell asset; wire audio; Vite static build.
5. Manual check with devtools clock spoofing / injected `now` for era and hour-boundary tests.
