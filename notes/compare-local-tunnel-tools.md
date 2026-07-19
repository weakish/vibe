# Local tunnel and exposure tools compared

Notes from a 2026-07-19 survey of **cloudflared**, **Pinggy**, **Ngrok**, **LocalXpose**, **LocalTunnel**, **Pangolin**, and **Tailscale**. Prices and limits are snapshots — check vendor sites before acting.

## Summary

These tools overlap but solve different problems:

| Goal | Lean toward |
| --- | --- |
| One-shot webhook / demo on localhost | **LocalTunnel** (free, flaky) or **Pinggy** (SSH, no signup) |
| Daily dev with inspection and stable URLs | **Ngrok** or **LocalXpose** |
| Production HTTP(S) on your domain, free edge | **cloudflared** (domain on Cloudflare) |
| Self-hosted “Cloudflare Tunnel + Access” on your VPS | **Pangolin** |
| Private access between your machines (not public ingress) | **Tailscale** |

**Tailscale is not a drop-in ngrok replacement** for public webhooks unless you use **Funnel** (public HTTPS via Tailscale’s relay). Most of the table below is about **inbound-from-internet** exposure; Tailscale is primarily **mesh VPN / ZTNA**.

---

## At a glance

| | Model | Public HTTP(S) | TCP / UDP | Persistent URL | Custom domain | Auth / ZTNA | Typical cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **cloudflared** | Cloudflare-managed tunnel | Yes (primary) | TCP/SSH/RDP need client `cloudflared`; **no public UDP** | Yes (needs CF DNS zone) | Yes (on Cloudflare) | Cloudflare Access (OIDC, etc.) | **Free** (CF account) |
| **Pinggy** | Managed SaaS (SSH-based) | Yes | **UDP, TLS** | Paid | Subdomain + **apex** | Basic auth, bearer, IP allowlist | Free tier; **~$3/mo** Pro |
| **Ngrok** | Managed ingress platform | Yes | TCP, TLS; **no UDP** | Paid | Subdomain only (no apex on lower tiers) | OAuth, SAML, webhooks | Free limited; **~$10/mo** hobbyist |
| **LocalXpose** | Managed SaaS | Yes | **HTTP/S, TCP, TLS, UDP** | Paid | Yes | Basic auth, keys, IP allowlist | Free (2 HTTP); **~$8/mo** Pro |
| **LocalTunnel** | Volunteer-hosted SaaS | Yes | **HTTP/HTTPS only** | Random each run | No | Tunnel password page | **Free** |
| **Pangolin** | Self-hosted (+ optional cloud) | Yes | Via proxy / tunnel to L4 services | Yes | Yes (Let’s Encrypt) | Built-in IdP, OIDC, TOTP, roles | **Free** CE (AGPL); VPS cost |
| **Tailscale** | Mesh VPN (WireGuard) | Via **Funnel** only | Tailnet L3/L4; Funnel is HTTPS | Funnel URL | Custom domain on Funnel (paid plans) | Tailnet ACLs, SSO on business | Free personal; **~$6+/user/mo** teams |

---

## cloudflared (Cloudflare Tunnel)

Outbound-only daemon (`cloudflared`) connects your origin to Cloudflare’s edge. No open inbound ports on the origin; traffic gets CDN, DDoS, and optional WAF.

**Strengths**

- **Free** on all Cloudflare plans; unlimited tunnels for HTTP routing.
- Production-grade edge (DDoS, caching, Access policies).
- Quick Tunnels (`trycloudflare.com`) for zero-account local tests.

**Limits**

- **Persistent hostnames need a domain on Cloudflare DNS** — Quick Tunnels are ephemeral and capped (~200 concurrent requests; no SSE).
- **Public hostname ingress is HTTP/HTTPS**; UDP is not available for public-facing routes.
- **100 MB request body** cap on proxied HTTP (free/Pro plans) — hurts large uploads (Nextcloud, Jellyfin, etc.).
- More setup than `ngrok http 3000` (account, tunnel token, DNS, ingress rules).

**Fit:** Homelab or small prod services already on Cloudflare DNS; you want free edge + Access, not raw UDP or huge uploads.

---

## Pinggy

Tunnel over **SSH** — no client install for a quick test (`ssh -R …`). Paid plans add CLI, GUI, custom domains, inspection UI.

**Strengths**

- Fastest “try it now” path (no signup on free tier).
- **UDP and TLS** tunnels; **unlimited bandwidth** on paid plans.
- **Apex/root domains** supported; cheaper entry paid tier (~**$3/mo**).

**Limits**

- Enterprise auth (OIDC/SAML) is thin vs Ngrok.
- Vendor-hosted; traffic transits Pinggy’s infrastructure.
- Marketing comparisons vs Ngrok — verify limits on [pinggy.io](https://pinggy.io) before relying on them.

**Fit:** Solo dev, webhooks, UDP (games/IoT), demos where Ngrok’s bandwidth cap or missing UDP hurts.

---

## Ngrok

De facto standard for **localhost → public URL**. Grew into a full **ingress platform** (routing, K8s operator, traffic policy, observability).

**Strengths**

- Mature CLI, docs, integrations; request inspection and replay.
- Strong **visitor auth** (OAuth, SAML) on paid tiers.
- TCP/TLS tunnels; stable URLs and reserved domains on paid plans.

**Limits**

- **No UDP.**
- Free/hobby tiers: **bandwidth caps** (~5 GB/mo on entry paid), sign-up required.
- Custom domains are **subdomain-only** on common plans (no apex).
- Price rises quickly for team/production features.

**Fit:** Teams already on Ngrok; need OAuth in front of a dev/staging URL; K8s/CI ingress story.

---

## LocalXpose

Ngrok-like **managed tunnel** with broader protocol support and a heavier “production tunnel” pitch.

**Strengths**

- **HTTP/S, TCP, TLS, UDP** on Pro; unlimited bandwidth (AUP-bound).
- Reserved subdomains, custom domains, wildcard tunnels.
- Built-in inspection dashboard, file server, always-on daemon.
- **~$8/mo** Pro undercuts Ngrok on bandwidth-heavy use.

**Limits**

- Smaller ecosystem than Ngrok.
- Free tier: **2 HTTP tunnels**, time limits, interstitial warning page.
- Still vendor-hosted SaaS.

**Fit:** Ngrok-shaped workflow but you need **UDP** or want **flat unlimited bandwidth** without Ngrok overages.

---

## LocalTunnel

`npm install -g localtunnel` → `lt --port 3000`. Random `*.loca.lt` URL.

**Strengths**

- **Free**, zero config, HTTP/HTTPS only.
- Fine for a quick Stripe/GitHub webhook test when it works.

**Limits**

- **Random URL every restart** — bad for persistent webhooks.
- **No TCP/UDP**; no inspection dashboard.
- **Reliability is the main risk** — volunteer-run service; recurring 502/503 reports; package updates are infrequent.
- Interstitial “tunnel password” page on some requests.

**Fit:** Disposable local tests only. Not for demos, prod, or anything time-sensitive.

---

## Pangolin

**Self-hosted** platform (Fossorial): **WireGuard** site connector (**Newt**) + **Traefik** reverse proxy + **identity-aware access** (local users, OIDC, TOTP, per-resource policies). Optional [Pangolin Cloud](https://app.pangolin.net/).

**Strengths**

- **You control the hub** (VPS with public IP) — no Cloudflare dependency.
- Per-resource auth, audit logs, browser SSH/RDP in some setups.
- Community Edition **AGPL-3.0**; CE free for personal use and small businesses (&lt;$100k revenue per their license).
- Often described as **“self-hosted Cloudflare Tunnel + Access”** — not a CDN.

**Limits**

- **Ops burden:** Docker Compose on a VPS, UDP 51820 (or equivalent), TLS, backups, upgrades.
- **Not Tailscale** — publishes selected services through your hub; doesn’t replace a full device mesh by itself.
- Performance: userspace WireGuard in Newt unless you opt into kernel WG.

**Fit:** Homelab or small team that wants **identity-gated exposure** without sending traffic through Cloudflare; comfortable running a VPS stack.

---

## Tailscale

**WireGuard mesh VPN**: your devices get stable tailnet IPs; ACLs control who reaches what. **Different default problem** than ngrok.

**Public exposure (when you need it)**

- **Tailscale Serve** — HTTPS to services for **tailnet** members only.
- **Tailscale Funnel** — public HTTPS URL via Tailscale’s relay (plan limits apply); not a general TCP/UDP tunnel broker.

**Strengths**

- Best-in-class **private** remote access (laptop ↔ home server ↔ VPS) without port forwarding.
- MagicDNS, subnet routers, exit nodes, SSH records.
- Already in this dotfiles **Brewfile** (`tailscale-app`) — good default for **machine-to-machine** access.

**Limits**

- **Funnel ≠ ngrok** — HTTPS-focused, Tailscale policy model, not arbitrary TCP/UDP public endpoints.
- Team features cost per seat; Headscale exists for self-hosted control plane but is a separate project.

**Fit:** “Reach my home LAN privately from anywhere.” Pair with **cloudflared** or **Pangolin** if you need **anonymous internet** ingress with your own domain story.

---

## How they cluster

```
                    PUBLIC INTERNET INGRESS
    ┌─────────────────────────────────────────────────────┐
    │  Quick / dev          │  Managed prod-ish           │
    │  LocalTunnel, Pinggy  │  Ngrok, LocalXpose          │
    ├───────────────────────┼─────────────────────────────┤
    │  Free edge + CF DNS   │  Self-hosted hub + IdP      │
    │  cloudflared          │  Pangolin                   │
    └───────────────────────┴─────────────────────────────┘

    PRIVATE MESH (tailnet) — often combined with one of the above
    Tailscale (+ Serve / Funnel for selective public HTTPS)
```

---

## Practical picks (subjective)

| Scenario | Suggestion |
| --- | --- |
| 30 s webhook test, OK if flaky | LocalTunnel |
| Webhook test, need it to stay up | Pinggy or Ngrok free/paid |
| UDP game server / IoT from localhost | Pinggy or LocalXpose |
| Expose `home.example.com` on Cloudflare, free | cloudflared |
| No Cloudflare; want SSO in front of homelab apps | Pangolin on a VPS |
| SSH to home Mac, no public ports | Tailscale |
| Public webhook URL on a stable custom domain, minimal ops | cloudflared or paid Ngrok/LocalXpose |

---

## Freshness

Prices and limits as of **2026-07-19**. Vendors change tiers often — especially Ngrok bandwidth and Tailscale Funnel limits. Pangolin is young (GitHub ~2024) but active; LocalTunnel’s hosted service health varies week to week.
