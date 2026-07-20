# Plan: Thai time (static page)

Single static page: current clock in Thailand’s historical/legal zone rules, HH:MM most of the time, Thai six-hour script + bell on the hour. ReasonReact.

## Goal

Ship one static web page that:

1. Shows **only** the current time as `HH:MM` (24-hour), nothing else on screen in the normal state.
2. Interprets “now” with zone rules driven by the **visitor’s system clock date** (see below).
3. On each new hour, **announces** with bell chimes using the **Thai six-hour** count, and while announcing replaces `HH:MM` with the Thai-script six-hour label (special cases below).

Out of scope for v1: date display, settings UI, timezone picker, second hand, localization toggles, server-side time.

## Project placement

New monorepo project: `thai-time/` (ReasonReact static app). Build output is static files only.

Plan lives here: `.agents/plans/thai-time.md`. Project-local notes later under `thai-time/` if needed.

## Timezone rules (from visitor system clock)

Drive zone choice from the **local civil date/time the browser reports** (system clock), not from network time.

| System clock instant | Zone | Notes |
|----------------------|------|--------|
| Before 1880-01-01 00:00:00 (local interpretation TBD — treat as civil date before Jan 1880) | **Error** | Do not display a clock; fail visibly (minimal error text is an exception to “nothing else”, or blank + `console`/thrown error — decide in impl: prefer a single short error string so the page is not a silent failure). |
| 1880-01-01 through 1920-03-31 inclusive | **Bangkok Mean Time (BMT)** | Historical offset ≈ **UTC+6:42:04**. Use a fixed offset (no DST). Confirm exact seconds against a cited source during impl. |
| 1920-04-01 onward | **Indochina Time (ICT)** | **UTC+7**, fixed. |

Display `HH:MM` in that zone (floor to minute; no seconds on screen).

**Impl note:** JS `Date` + `Intl` will not give BMT. Compute as `UTC + offset` from `Date.now()` (or `Date` UTC fields), after classifying the **uncorrected** system instant into the three eras. Classification must use a defined calendar boundary (recommend: compare against absolute UTC instants that correspond to “local Bangkok civil” boundaries only if we document them; simpler approach: classify using UTC year/month/day of the system `Date`, with documented caveat that pre-1920 “visitor local calendar” ≠ Bangkok civil — acceptable for this toy unless we tighten later).

Open decision (resolve in impl, document in project README if any): era boundaries as **UTC calendar dates** vs **ICT/BMT civil dates**. Prefer **UTC date thresholds** for determinism: error if `date < 1880-01-01T00:00:00Z`; BMT if `date <= 1920-03-31T23:59:59.999Z`; else ICT — **unless** product intent is “wall date in Thailand,” in which case convert first. Flag in first PR.

## Normal UI

- Full viewport, no chrome, no title text in the document body beyond the time (page `<title>` can be minimal, e.g. `thai-time`).
- One centered (or otherwise single) text node: `HH:MM` zero-padded.
- Update at least every second (or on `visibilitychange`) so hour rollover is caught; display still minute precision only.
- No other visible widgets.

## On-the-hour announcement

### Trigger

When the displayed zone’s hour advances (minute rolls to `00`, or first paint already at `:00` — **do not** re-announce on refresh at `:00` if we can avoid annoyance: announce only on **transition into** `:00` while the page is open). If the tab was backgrounded across the hour, announce on next visible tick if the hour boundary was crossed while hidden (optional; prefer yes so a backgrounded tab still chimes once when noticed).

### Chime count (Thai six-hour)

Chime **N** times where **N** is the Thai six-hour hour index for that clock hour — **not** the 24-hour number and not 12-hour.

Reference (user): **22:00 → 4 chimes** (สี่ทุ่ม).

| ICT/BMT hour | Label (display during announce) | Chimes |
|-------------:|---------------------------------|-------:|
| 00 | เที่ยงคืน | TBD (see open questions) |
| 01 | ตีหนึ่ง | 1 |
| 02 | ตีสอง | 2 |
| 03 | ตีสาม | 3 |
| 04 | ตีสี่ | 4 |
| 05 | ตีห้า | 5 |
| 06 | ย่ำรุ่ง | TBD |
| 07 | หนึ่งโมงเช้า | 1 |
| 08 | สองโมงเช้า | 2 |
| 09 | สามโมงเช้า | 3 |
| 10 | สี่โมงเช้า | 4 |
| 11 | ห้าโมงเช้า | 5 |
| 12 | เที่ยงวัน | TBD |
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
- 00:00 → **เที่ยงคืน** (not หกทุ่ม / สองยาม)

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

- **ReasonReact** (ReScript + `@rescript/react` is the practical 2026 path; use Reason-flavored syntax only if the toolchain still supports it cleanly — default recommendation: **ReScript React** labeled as the ReasonReact lineage in project docs, unless pinning classic `reason-react` is required by name).
- Bundler: Vite (or similar) → static `dist/`.
- No backend.

Confirm package names at scaffold time; keep the app a single page component + small pure modules:

- `Zone.res` — era classify + offset → wall `HH:MM` + hour/minute
- `ThaiClock.res` — hour → label + chime count
- `App.res` — tick, announce state machine, render one string
- `Bell.res` / audio helper — play N chimes

## Acceptance checks

- [ ] At a normal modern system time: shows ICT `HH:MM` only.
- [ ] System date forced into 1880–1920-03-31: wall time uses BMT offset (differs from ICT by ~18 minutes — visible in `HH:MM` vs a reference converter).
- [ ] System date before 1880: error path, no normal clock.
- [ ] On hour change to 22:00: label **สี่ทุ่ม**, **4** bell plays; then back to `22:00`.
- [ ] 06/16/17/18/00 use the mandated Thai strings (not the rejected forms).
- [ ] Static deploy: open `index.html` (or static host) with no server logic.

## Open questions (resolve during impl)

1. **Era boundary basis** — UTC calendar vs Thailand civil (see above).
2. **Chime count for ย่ำรุ่ง / เที่ยงวัน / เที่ยงคืน** — historical temple practice varies (often special patterns, not a simple 1–6). Options: (a) 1 chime, (b) 6 chimes, (c) distinct sample. Default if unspecified: **1 chime** for the three named pivots so announcement still “happens.”
3. **Exact BMT offset** — lock `+6:42:04` vs `+6:42:00` from a cited source.
4. **Reason vs ReScript branding** — user said ReasonReact; scaffold should satisfy that request with the maintained toolchain.

## Implementation order

1. Scaffold `thai-time/` static ReasonReact/ReScript app.
2. Pure `ThaiClock` mapping + unit tests for all 24 hours (labels + chime counts + forbidden strings).
3. Pure `Zone` era + offset + format `HH:MM` tests (fixture instants).
4. UI tick + announce state machine; add bell asset; wire audio.
5. Manual check with devtools clock spoofing / injected `now` for era and hour-boundary tests.
