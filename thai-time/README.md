# thai-time

Static page: Bangkok wall time as four-digit HHMM (prefer Thai numerals), with Thai six-hour hour announcements and bell chimes.

## Stack

- Reason + Melange + ReasonReact (opam + Dune)
- Vite (dev / static `dist/`)
- Jest + melange-jest (npm)
- Playwright (Chromium) for bell-toggle UI

Heavier than a typical JS-only vibe project: you need **opam** (OCaml 5.2 switch), Melange, **and** npm. If `opam` is missing, install it first ([opam](https://opam.ocaml.org/doc/Install.html)); `opam switch create` will fail without it.

## Setup

```sh
cd thai-time
opam switch create . 5.2.0 -y --deps-only   # first time
eval $(opam env)
npm install
```

## Commands

```sh
npm run build        # dune → Melange JS (app + tests)
npx playwright install chromium   # once; Linux may also need:
npx playwright install-deps chromium
npm test             # Jest, then Playwright bell UI
npm run test:e2e     # build, then Playwright only (starts Vite)
npm run dev          # Vite dev server
npm run bundle       # production static dist/
```

The corner bell shows a compact **Space** keycap under the icon. Click the bell, or press Space, to toggle chimes (browser autoplay policy). Default off. Unarmed announces still show the Thai word label silently.

Plan: [`.agents/plans/thai-time.md`](../.agents/plans/thai-time.md).

## Known gaps

- One-second polling; no sub-minute precision on screen.
- `Zone.resolve()` is cached for the session; no recovery from transient `Intl` failures without reload.
- Probe B uses a fixed 2026-07-20 instant, not the visitor clock.
- Bell complete timing assumes `bell.mp3` stays shorter than `CHIME_GAP_MS` (800 ms).
- Heavy deps: opam + npm + a large `package-lock.json`.
- Arming mid–silent-announce still does not play remaining chimes (post-v1; see the plan TODO).
