---
name: deploy-boffin
description: Deploy Boffin (a Node.js chat web UI for the Cursor Agent CLI, Grok CLI, and/or OpenCode CLI) to a Debian 13 (trixie) server whose SSH public-key access and git identity are already configured, with Boffin and the chosen agent(s) running as a dedicated boffin user behind systemd and a Caddy HTTPS reverse proxy, administered and updated over SSH as the operator's GitHub-username account. Use when asked to deploy, install, set up, update, roll back, or troubleshoot Boffin on such a server.
---

# Deploy Boffin to Debian trixie

Deploy the Boffin repository (the repository root is the folder containing this skill at `.agents/skills/deploy-boffin/SKILL.md` — the directory with `package.json`, `src/index.js`, and `config.example.json`) to a Debian 13 (trixie) server. Read `README.md` at the repository root first for the architecture and security model; this skill is the executable procedure.

## Assumptions — do not redo this setup

This skill is written for a deployment environment that is **already configured**:

- SSH public-key authentication already works for the operator's account on the server. This skill will **not** install keys, edit `sshd_config`, enable or disable password authentication, or handle any initial/root password. If SSH login fails, stop and let the operator fix their SSH setup outside this skill.
- A git identity (`user.name` / `user.email`) is already configured, locally and for the operator's account on the server. This skill asks for no name or email; it only reads the already-configured identity and copies it to the `boffin` service account (step 3) so the agent's commits carry it. If no identity is configured, stop and let the operator configure it.
- The operator's account has `sudo` on the server (needed to create the `boffin` user, install packages, and manage the systemd service and Caddy).
- The firewall — host-based and/or the provider's — is **already configured** to permit SSH, port 80, and port 443. This skill will **not** install, enable, or modify any firewall (no `ufw`/`nftables`/provider-rule changes, for any port). If reachability checks later suggest a port is blocked, stop and let the operator adjust their own firewall outside this skill.

Two different users are involved — do not conflate them:

- **`<github-username>`** — the operator's own account. It is used **only for SSH**: logging in to administer the server, and git-over-SSH operations (the `deploy` remote) when deploying or upgrading the Boffin source. It is *not* the account Boffin runs as, not the agent account, and not the Boffin web-login username.
- **`boffin`** — a dedicated, unprivileged service account created in step 3. The Boffin service and the chosen CLI(s) run as `boffin`, the agent's credentials and commits live in `/home/boffin`, and `/srv/boffin` is owned exclusively by `boffin:boffin`. You never SSH in as `boffin` (no key is installed for it); you reach it via `sudo -u boffin` / `sudo su - boffin` from the operator's SSH login, and git-over-SSH pushes/fetches run `git-upload-pack` / `git-receive-pack` as `boffin` via a narrow `sudoers` rule so git never runs inside `/srv/boffin` as `<github-username>`.

Architecture you are building:

```text
Browser ──443/TLS──▶ Caddy ──127.0.0.1:8080 + X-Forwarded-For──▶ Boffin (systemd, user boffin)
                                                                      │ spawns agent --force, grok --always-approve, and/or opencode --auto
                                                                      ▼
                          Cursor, Grok, and/or OpenCode CLI (user boffin) ──edits/commits──▶ /srv/boffin
Operator ──ssh <github-username>@<hostname>──▶ administer via sudo; push/fetch over SSH (remote git runs as boffin via sudo)
```

## Inputs — ask when missing

If the operator has not already supplied them in the request, ask for:

| Input | Placeholder | How it is used |
| --- | --- | --- |
| The operator's **GitHub username** | `<github-username>` | Only as the SSH user: `ssh <github-username>@<hostname>` for administration, and the same SSH identity for the `deploy` git remote when pushing Boffin source updates. |
| The **deployment server hostname** | `<hostname>` | A fully qualified hostname (e.g. `boffin.example.com`) used for **both** SSH (`ssh <github-username>@<hostname>`) and the deployed service (`https://<hostname>`). It must resolve to the server. Passkeys bind to this hostname, so confirm it is final — changing it later orphans all passkeys. |
| Which **agent(s)** to install | `<agents>` | Any combination of `cursor`, `grok`, and `opencode` (for example `cursor`, `grok`, `opencode`, or any two). Written to `config.json` as a `"agents"` array. If they have not named one, ask — do not silently pick. **Do not ask for a model.** Cursor always uses Composer 2.5 (`composer-2.5`), Grok always uses Grok 4.7 High (`grok-4.7/high`), and OpenCode always uses Big Pickle (`opencode/big-pickle`). The owner can pick a model (and agent, when more than one is enabled) when starting a new chat in the app. |

Derived, do not ask separately: SSH target `<github-username>@<hostname>`, service URL `https://<hostname>`, service account `boffin`, Cursor binary `/home/boffin/.local/bin/agent`, Grok binary `/home/boffin/.grok/bin/grok`, OpenCode binary `/home/boffin/.opencode/bin/opencode`, workdir `/srv/boffin`, Boffin web-login username `boffin`.

Default unless the operator volunteers otherwise: deploy the current local checkout `HEAD` (committed content only — `git push` ignores uncommitted and untracked files).

## Ground rules

- **Do not invent the inputs** (GitHub username, hostname, or agents), and do not substitute values from any previous deployment (a different operator, server, or branch). Do not ask which model to use.
- **Never write secrets into the repository or kept output.** Passwords and API keys must not be committed or placed in command-line arguments where a process listing would expose them. The one generated Boffin bootstrap password is written only to the server's `config.json` (mode `0600`) and reported to the operator once, through whatever secure channel they prefer.
- **Ask the operator before irreversible or exposure-changing actions**: overwriting an existing Caddyfile, discarding uncommitted changes on the server, or rebooting.
- Verify every step before moving on. If a precondition below fails, stop and report it rather than reconfiguring SSH or git identity yourself — that setup belongs to the operator's deployment environment, not this skill.
- Always run git inside `/srv/boffin` as `boffin` (via `sudo -u boffin` interactively, or via `remote.deploy.uploadpack` / `receivepack` over SSH). Never run git inside `/srv/boffin` as `<github-username>` or `root`: `boffin` owns `.git` (including hooks and config), so running git there as a more privileged user would cross the isolation boundary — and creates mismatched file ownership. Never `rsync`/`scp` over `/srv/boffin`.
- Boffin must stay bound to `127.0.0.1` in production, with Caddy as the only public entry. Port 8080 therefore needs no firewall rule — and since the firewall is pre-configured (see Assumptions), this skill neither adds one nor changes any other rule.

## Step 1 — Verify access and preconditions (no setup)

Locally, from the repository checkout:

```bash
git status   # know what is committed; only committed content will be deployed
```

On the server, using the already-configured SSH access:

```bash
ssh <github-username>@<hostname>
id                                   # confirm you are the operator's account
cat /etc/debian_version              # expect a 13.x (trixie) release
git config user.name                 # must print the pre-configured name — if empty, stop (see Assumptions)
git config user.email                # must print the pre-configured email — if empty, stop
sudo -v                              # confirm sudo works
getent hosts <hostname>              # the hostname must resolve to this server
```

Because SSH is already configured, connecting should not present an unknown host key. If it does, stop and confirm the fingerprint with the operator through a trusted channel before accepting it. Likewise confirm DNS for `<hostname>` points at this server before step 7 (with `dig +short <hostname>` if available, or the DNS provider's console); Let's Encrypt issuance fails otherwise. The already-configured firewall is assumed to permit SSH, 80, and 443 (see Assumptions) — this is only surfaced by the external checks in step 8; if one fails, report it to the operator rather than changing any firewall rules.

## Step 2 — Base packages

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates git caddy nodejs
node --version   # must be >= 20 (package.json engines); trixie ships Node 20.x
```

If Node ever reports < 20, stop and install a supported Node.js (e.g. the NodeSource 22 LTS repository) before continuing. Boffin has zero npm dependencies — do not run `npm install`. The Cursor, Grok, and OpenCode CLIs bundle their own runtimes. No firewall tooling is installed or configured here: the firewall is part of the pre-configured environment, and port 8080 needs no rule because Boffin is loopback-only.

**Bundled static assets (optional, for slow client links):** Boffin serves unbundled files by default so agent edits to `public/` show up after refresh. The owner can switch to **release** in Settings, which runs `bun build` on the server and serves hashed bundles from `public/dist/`. Install Bun for the `boffin` user before using that mode:

```bash
sudo -u boffin bash /srv/boffin/scripts/install-bun.sh
sudo -u boffin /home/boffin/.bun/bin/bun --version
```

That script downloads the same GitHub release zip as `bun.sh/install`, but extracts with `unzip` when available and otherwise with `python3` (no `unzip` Debian package required if `python3` is already on the system).

Set `"bun_bin": "/home/boffin/.bun/bin/bun"` in `config.json` (step 5). The service PATH in step 6 includes `/home/boffin/.bun/bin`, so an unset `bun_bin` still runs `bun`. After pushing UI changes you expect to stay stable for a while, the owner switches to **release** once in the browser. That updates the running process. The other way is `sudo -u boffin node scripts/bundle-static.mjs` from `/srv/boffin`, then write `data/static-assets.json` and restart. The script only fills `public/dist/` and does not change the mode the process has already loaded. The state file must be version 1, and the object in `public/dist/manifest.json` must be nested under `manifest`:

```json
{
  "version": 1,
  "mode": "release",
  "manifest": {
    "builtAt": "<from public/dist/manifest.json>",
    "fingerprint": "<from public/dist/manifest.json>",
    "app": "/dist/app-<hash>.js",
    "spec": "/dist/spec-<hash>.js",
    "styles": "/dist/styles-<hash>.css"
  }
}
```

Switch back to **development** while actively editing `public/`. `public/dist/` is generated output and is not committed.

## Step 3 — Dedicated user and code

Create the service account (no SSH key is installed for `boffin` — all SSH stays on `<github-username>`, and `<github-username>` is **not** added to the `boffin` group):

```bash
sudo useradd --create-home --shell /bin/bash boffin
```

Create the working directory owned exclusively by `boffin:boffin` (`0750`), initialize the repository as `boffin`, and allow pushes into its checked-out branch:

```bash
# On the server, over SSH as <github-username>:
sudo install -d -o boffin -g boffin -m 0750 /srv/boffin
sudo -u boffin git init --initial-branch=main /srv/boffin
sudo -u boffin git -C /srv/boffin config receive.denyCurrentBranch updateInstead
```

Allow `<github-username>` to invoke only `git-upload-pack` and `git-receive-pack` on `/srv/boffin` **as `boffin`** without a password prompt, so git-over-SSH never executes `.git/hooks` or `.git/config` under `<github-username>`'s privileges:

```bash
# On the server, over SSH as <github-username>:
tmp=$(mktemp)
cat <<'EOF' > "$tmp"
<github-username> ALL=(boffin) NOPASSWD: /usr/bin/git-upload-pack /srv/boffin, /usr/bin/git-receive-pack /srv/boffin
EOF
sudo visudo -cf "$tmp" && sudo install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/boffin
rm -f "$tmp"
```

Deploy from the operator's machine. Configure the `deploy` remote so Git runs the server-side pack commands as `boffin` (`-n` fails fast if `sudoers` is misconfigured; `-H` sets `HOME=/home/boffin`). Pushing updates the server's working tree in the same step and **refuses if the tree is dirty** (tracked files modified or staged) — by design, so a deploy never overwrites uncommitted agent work. Pushes must also be fast-forward.

```bash
# On the operator's machine, from the repository checkout:
git remote add deploy <github-username>@<hostname>:/srv/boffin   # skip if the remote already exists
git config remote.deploy.uploadpack "sudo -n -H -u boffin /usr/bin/git-upload-pack"
git config remote.deploy.receivepack "sudo -n -H -u boffin /usr/bin/git-receive-pack"
git push deploy HEAD:main
```

Verify on the server that the push landed and every file stays owned by `boffin:boffin`:

```bash
# On the server:
sudo -u boffin ls /srv/boffin
sudo -u boffin stat -c '%U:%G' /srv/boffin/src/index.js   # expect: boffin:boffin
```

Confirm with the operator before pushing if the checkout has uncommitted changes they expected to be deployed — those do not transfer. `config.json` and `data/` are git-ignored, so they stay out of the repo and out of the agent's commits; untracked files on the server never block a push unless a pushed commit adds a file with the same path.

Now give the agent its commit identity — copy the operator's already-configured identity (verified in step 1) to the `boffin` account; do not invent or ask for a different one:

```bash
GIT_NAME="$(git config user.name)"
GIT_EMAIL="$(git config user.email)"
test -n "$GIT_NAME" && test -n "$GIT_EMAIL"
sudo -u boffin env HOME=/home/boffin git config --global user.name "$GIT_NAME"
sudo -u boffin env HOME=/home/boffin git config --global user.email "$GIT_EMAIL"
```

Then verify both sides of the repository:

```bash
sudo -u boffin git -C /srv/boffin status              # works, no "dubious ownership" error
sudo -H -u boffin git config --global --get user.email   # prints the copied identity
# Locally: git ls-remote deploy   # confirms SSH + sudoers uploadpack works
# Continue to step 4 to install and authenticate the chosen CLI(s) as boffin.
```

## Step 4 — Install and authenticate the chosen CLI(s) (as `boffin`)

The agent runs as the dedicated `boffin` account created in step 3, so it is installed and authenticated as that account. Install **only** the CLIs named in `<agents>`.

### Cursor (when `<agents>` includes `cursor`)

```bash
sudo su - boffin -c 'curl https://cursor.com/install -fsS | bash'
sudo su - boffin -c '~/.local/bin/agent --version'
```

Authenticate with the default browser login (interactive, needs the operator now):

```bash
sudo su - boffin -c 'NO_OPEN_BROWSER=1 ~/.local/bin/agent login'   # prints a URL for the operator to approve in their browser
sudo su - boffin -c '~/.local/bin/agent status'                    # confirm sign-in
```

If the operator has told you they use an API key instead, follow Cursor's current CLI documentation for supplying it to the `boffin` user's environment, and do not write the key into the repository.

### Grok (when `<agents>` includes `grok`)

The Grok installer also places an `agent` binary next to `grok`. **Do not put `/home/boffin/.grok/bin` on PATH** (including the systemd unit in step 6). Point `grok_bin` at `/home/boffin/.grok/bin/grok`. If the installer overwrites `/home/boffin/.local/bin/agent`, re-run the Cursor install above before continuing.

```bash
sudo su - boffin -c 'curl -fsSL https://x.ai/cli/install.sh | bash'
sudo su - boffin -c '~/.grok/bin/grok --version'
# Must still be Cursor's CLI when Cursor is enabled:
sudo su - boffin -c '~/.local/bin/agent --version'
```

Authenticate with device-code login (headless; needs the operator now):

```bash
sudo su - boffin -c '~/.grok/bin/grok login --device-auth'   # prints a URL/code for the operator to approve
```

### OpenCode (when `<agents>` includes `opencode`)

The OpenCode installer puts the binary in `/home/boffin/.opencode/bin/opencode` and adds that directory to the shell's `PATH`. Point `opencode_bin` at the real path so the service does not depend on `PATH` under systemd.

```bash
sudo su - boffin -c 'curl -fsSL https://opencode.ai/install | bash'
sudo su - boffin -c '~/.opencode/bin/opencode --version'
```

Authenticate with the provider or the OpenCode gateway (interactive, needs the operator now):

```bash
sudo su - boffin -c '~/.opencode/bin/opencode auth login'
sudo su - boffin -c '~/.opencode/bin/opencode models'   # confirm the chosen model is available
```

Credentials land in `/home/boffin`, which is why the systemd unit in step 6 sets `HOME`. If sign-in later expires, chats fail with auth errors; re-run the matching login (`agent status`, `grok login --device-auth`, or `opencode auth login` from step 4).

## Step 5 — Boffin configuration

Create `/srv/boffin/config.json` owned by `boffin`, mode `0600` (e.g. `sudo -u boffin install -m 600 /dev/null /srv/boffin/config.json`, edit it as root or via `sudo -e`, then verify ownership and mode with `sudo ls -l /srv/boffin/config.json` — `/srv/boffin` is mode `0750`, so the operator cannot `ls` it directly; fix with `sudo chown boffin:boffin /srv/boffin/config.json && sudo chmod 600 /srv/boffin/config.json` if needed). Per `src/config.js`, the config lives in the working directory and the server is started as `node src/index.js <workdir>`. Based on `config.example.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8080,
  "agents": ["cursor"],
  "model": "composer-2.5",
  "grok_model": "grok-4.7/high",
  "opencode_model": "opencode/big-pickle",
  "agent_bin": "/home/boffin/.local/bin/agent",
  "grok_bin": "/home/boffin/.grok/bin/grok",
  "opencode_bin": "/home/boffin/.opencode/bin/opencode",
  "bun_bin": "/home/boffin/.bun/bin/bun",
  "force": true,
  "username": "boffin",
  "password": "<generated-on-the-server>",
  "state_file": "data/state.json"
}
```

- Set `"agents"` from `<agents>` using any combination of `"cursor"`, `"grok"`, and `"opencode"`. Always write `"model": "composer-2.5"`, `"grok_model": "grok-4.7/high"`, and `"opencode_model": "opencode/big-pickle"` — do not ask for a model. Omit `agent_bin` only when Cursor is not installed; omit `grok_bin` only when Grok is not installed; omit `opencode_bin` only when OpenCode is not installed. Set `"bun_bin"` to `/home/boffin/.bun/bin/bun` when Bun is installed for release mode. Use absolute paths to avoid PATH surprises under systemd. The web-login `username` is the literal `boffin` — the GitHub username plays no role here.
- Generate the password on the server (e.g. `openssl rand -base64 24`), put it only in this file, and report it to the operator once at handover.
- **What the password is for:** it is only the bootstrap credential for first-time owner passkey enrollment. Once an owner passkey exists, the server answers "The password is no longer used" and sign-in is passkey-only. Whoever enrolls first becomes the owner, so the operator must enroll as the very first action after step 7 — from the moment Caddy is live, the service is publicly reachable (enrollment is still gated by this password and per-client rate limits, but do not leave it unenrolled).

## Step 6 — systemd service

Write `/etc/systemd/system/boffin.service` (via `sudo tee`). Note the service runs as the dedicated `boffin` user, not the operator's account:

```ini
[Unit]
Description=Boffin chat UI
After=network-online.target
Wants=network-online.target

[Service]
User=boffin
Group=boffin
WorkingDirectory=/srv/boffin
Environment=HOME=/home/boffin
Environment=PATH=/home/boffin/.local/bin:/home/boffin/.bun/bin:/usr/local/bin:/usr/bin:/bin
# Do not prepend /home/boffin/.grok/bin — that directory's `agent` would shadow Cursor.
ExecStart=/usr/bin/node /srv/boffin/src/index.js /srv/boffin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now boffin
journalctl -u boffin -n 50   # expect: [boffin] listening on http://127.0.0.1:8080
curl -i http://127.0.0.1:8080/api/session   # must return 401 (auth enforced on /api/*)
```

Do not use `/` as the auth check — it is a public static file and returns 200.

**Verify per-client rate limiting now**, while the server is still loopback-only and the password is still active (this only works before an owner passkey retires the password). Behind Caddy every request would arrive from `127.0.0.1`, so `src/attempt-limit.js` trusts `X-Forwarded-For` from loopback peers only, taking its last entry; one host can therefore play several clients:

```bash
attempt() { curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $1" -d '{"username":"x","password":"wrong-password"}' http://127.0.0.1:8080/api/auth/password; }
for i in $(seq 9); do attempt 203.0.113.7; done   # expect: 401 eight times, then 429
attempt 198.51.100.9                              # expect: 401 — a different client has its own budget
sudo systemctl restart boffin                     # clear the in-memory counters
```

Expected limits (from `src/attempt-limit.js`): 8 password and 30 passkey attempts per client address per 15 minutes. If the second client is also throttled, do not proceed to step 7 — investigate the proxy/address handling first.

## Step 7 — Caddy HTTPS reverse proxy

Replace `/etc/caddy/Caddyfile` (back it up first with `sudo cp -a`, and get the operator's approval if it already serves something):

```caddyfile
<hostname> {
    encode zstd gzip
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Forwarded-For {remote_host}
    }
}
```

`encode zstd gzip` compresses at the edge. Debian 13 ships Caddy 2.6.2, and a bare `encode` enables no algorithms, so name them. Left to right is the preference when the client sends no q-factor: zstd, then gzip. Only responses longer than 512 bytes are compressed, and only the default types (`text/*`, `application/json*`, `application/javascript*`, `image/svg+xml*`, and a few XML feeds). HTML, CSS, JavaScript, and large JSON qualify. The manifest is not a default type, `public/icon.svg` is under 512 bytes, and the NDJSON chat stream and images are not compressed. Caddy 2.6 leaves the ETag unchanged, so Boffin's strong tag of the raw bytes still 304s. Do not compress in Node, and do not suffix that ETag. A newer Caddy appends the coding and strips that suffix from `If-None-Match`; a suffix added here would miss.

`header Strict-Transport-Security "max-age=31536000"` tells browsers to stick to HTTPS for `<hostname>` (Caddy does not set HSTS by default, and Caddy's automatic port-80 redirect does not run site handlers, so the header is sent only over HTTPS). `includeSubDomains` is omitted so unrelated subdomains are not affected if `<hostname>` is an apex domain.

The `header_up` line **replaces** the header with the real TCP peer, so a client cannot inject its own value; Boffin only trusts it because the connection comes from loopback. This is also what makes passkeys possible: WebAuthn requires HTTPS on a stable hostname, and the origin/RP ID is derived from the request `Origin` (see `src/webauthn.js`), so `<hostname>` must be the final hostname.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains the Let's Encrypt certificate automatically once DNS resolves and ports 80/443 are reachable. If issuance fails, check DNS propagation first; if DNS is correct, the pre-configured firewall is likely not permitting 80/443 — report that to the operator to fix in their firewall setup rather than changing any rules yourself.

## Step 8 — End-to-end verification

Do not hand over until all of these pass:

- [ ] SSH: `ssh <github-username>@<hostname>` works in a fresh connection.
- [ ] Web: `curl -I https://<hostname>/api/session` returns **401** over a valid certificate and includes `strict-transport-security` (`/` returning 200 is expected).
- [ ] Compression: `curl -sI -H 'Accept-Encoding: gzip' https://<hostname>/app.js` includes `content-encoding: gzip` or `zstd` and an ETag. `curl -sI http://127.0.0.1:8080/app.js` includes an ETag and no `content-encoding`.
- [ ] Service: `systemctl is-enabled boffin caddy` both report enabled; `journalctl -u boffin` is clean; `systemctl show -p User boffin` confirms the service runs as `boffin`.
- [ ] **Operator enrolls the owner passkey immediately:** open `https://<hostname>`, sign in with username `boffin` and the generated password, create the owner passkey. Then confirm a fresh browser session signs in with the passkey and the password is now refused ("The password is no longer used").
- [ ] Agent: the operator sends a trivial chat message (e.g. "say hi") and gets a streamed reply — this exercises Caddy streaming, the systemd service, and the `boffin`-user CLI login in one shot. If more than one agent is enabled, start a new chat as owner and confirm each enabled agent (Cursor, Grok, OpenCode) can be selected.
- [ ] Agent git: on the server, `sudo -u boffin git -C /srv/boffin status` and `sudo -H -u boffin git config --global --get user.email` work with no "dubious ownership" error, the latter printing the identity copied in step 3.
- [ ] Persistence across reboot — optionally prove with a reboot if the operator accepts a few minutes of downtime.

## Step 9 — Handover

Give the operator:

- The URL `https://<hostname>`, the Boffin username (`boffin`) and generated password (needed only until enrollment — confirm enrollment happened), and the SSH command `ssh <github-username>@<hostname>`.
- This cheat sheet (server commands over that SSH login):
  - `sudo systemctl restart boffin`, `journalctl -u boffin -f`, `sudo systemctl reload caddy`
  - Cursor: `sudo su - boffin -c '~/.local/bin/agent status'`
  - Grok: `sudo su - boffin -c '~/.grok/bin/grok login --device-auth'` (only if sign-in expired)
  - OpenCode: `sudo su - boffin -c '~/.opencode/bin/opencode auth login'` (only if sign-in expired)
  - Deploy an update: follow "Updating" below (pull/push over SSH, then restart the service).
  - Fetch the agent's own commits: locally `git fetch deploy` at any time (remote git runs as `boffin` via `sudo`), or inspect on the server with `sudo -u boffin git -C /srv/boffin log`.

## Updating after the first deploy

After the one-time migration below, `remote.deploy.uploadpack` and `remote.deploy.receivepack` run Git as `boffin`, so an update is a pull/push and a restart — no further ownership changes, no `chmod`, and no need to stop the service first (a push only ever lands on a clean, fast-forward tree).

**Migrate a shared-group server once** before those steps if `<github-username>` is still a member of group `boffin`, `/srv/boffin` is mode `2775`, or the `deploy` remote has no `uploadpack` / `receivepack`. Until then, `git pull` / `git push` still run as `<github-username>` inside the `boffin`-writable `.git` (hooks and config execute as the operator), and the push checks out files that are no longer made group-writable, so the agent cannot edit them.

On the server, over SSH as `<github-username>`, install the `/etc/sudoers.d/boffin` rule from step 3 if it is absent, then give the tree to `boffin` and drop the shared-group bits. This `chown` is only for this migration; later updates must not chown the tree:

```bash
sudo chown -R boffin:boffin /srv/boffin
sudo find /srv/boffin -type d -exec chmod g-s,g-w,o-rwx {} +
sudo chmod -R g-w /srv/boffin
sudo chmod 0750 /srv/boffin
if sudo -u boffin git -C /srv/boffin config --get core.sharedRepository >/dev/null; then
  sudo -u boffin git -C /srv/boffin config --unset-all core.sharedRepository
fi
if getent group boffin | awk -F: '{print $4}' | tr ',' '\n' | grep -Fqx '<github-username>'; then
  sudo gpasswd -d <github-username> boffin
fi
sudo sed -i '/^UMask=0002$/d' /etc/systemd/system/boffin.service
sudo systemctl daemon-reload
```

`chmod` only clears setgid, group write, and other access; it does not add bits. `config.json` and other `0600` files, including those under `data/`, stay `0600`. `data/` is a directory and ends as `0750`, like `/srv/boffin` — do not chmod it to `0600` (that drops execute and the service cannot enter it). Log out of SSH and back in so this session drops group `boffin`. On the operator's machine, set the step 3 `remote.deploy.uploadpack` and `remote.deploy.receivepack` values when `git config --get-regexp '^remote\.deploy\.(upload|receive)pack'` does not already print them.

1. Locally: `git pull --rebase deploy main` to bring in any commits the agent made, then `git push deploy HEAD:main`.
2. Rejected as **non-fast-forward**: the agent committed since your last fetch — repeat step 1.
3. Rejected because the **working directory is dirty** ("refusing to update checked out branch" / unstaged or uncommitted changes): this is intentional — nothing was overwritten, and a chat may be in progress. Wait for any running chat to finish, then settle the agent's edits **as `boffin`** over SSH: `sudo -u boffin git -C /srv/boffin status` (and `diff` if dirty). Either commit them (`sudo -H -u boffin git -C /srv/boffin commit -am ...`, then go to step 1) or — only with the operator's explicit approval — discard them (`sudo -u boffin git -C /srv/boffin checkout -- .`). Never force the push.
4. `ssh <github-username>@<hostname> sudo systemctl restart boffin`. Code changes, yours or the agent's, take effect only on restart; while chatting, the agent itself cannot restart the service for you.
5. If `config.example.json` gained new keys in an update, merge them into the server's `config.json` by hand — it is git-ignored and is never updated by a push. Unknown keys in `config.json` make the server refuse to start, so also remove keys an update drops. `config.json` stays owned by `boffin`, mode `0600`.

## Rollback and troubleshooting

- **Bad agent edit broke the service:** the agent is allowed to modify Boffin's own source in `/srv/boffin`; a bad edit can crash the service on restart. Recover on the server as `boffin`: `sudo -u boffin git -C /srv/boffin log --oneline -5`, then `sudo -u boffin git -C /srv/boffin reset --hard <good-commit>` (or `git revert <bad-commit>`), then `sudo systemctl restart boffin`. Uncommitted breakage: `sudo -u boffin git -C /srv/boffin checkout -- .`; also remove stray untracked files with `sudo -u boffin git -C /srv/boffin clean -fd -e config.json -e data` only after checking `status` (ignored files such as `config.json` and `data/` are kept by default).
- **Chats fail with agent auth errors:** the Cursor, Grok, or OpenCode login (as `boffin`) expired. On the server, re-run the matching login from step 4, then `sudo systemctl restart boffin`.
- **Certificate issuance fails:** DNS for `<hostname>` does not point at the server yet, or the pre-configured firewall blocks 80/443. Check `journalctl -u caddy` and DNS yourself; firewall changes are the operator's, outside this skill — do not install or reconfigure `ufw`/provider rules to fix it.
- **Everyone shares one rate-limit budget / instant 429s:** the proxy is not sending the header, or Boffin is not behind loopback Caddy. Confirm the Caddyfile `header_up` line from step 7 and that `host` is still `127.0.0.1` in `config.json`. Boffin ignores `X-Forwarded-For` from non-loopback peers by design, so direct exposure cannot be spoofed but collapses all clients into the peer's bucket. A local process (including the agent) can set the header itself over loopback — accepted, since it can already read `config.json`.
- **Passkeys stopped working after a change:** passkeys are bound to the hostname (WebAuthn RP ID). Since `<hostname>` is the server's own hostname it should never change; if it ever does, the operator must re-enroll — there is no migration.
- **`git push deploy` or `git fetch deploy` fails with `sudo: a password is required` or permission denied:** verify `/etc/sudoers.d/boffin` exists with mode `0440` (check with `sudo visudo -c`) and matches `<github-username>`, and verify `git config --get-regexp '^remote\.deploy\.'` locally has `uploadpack` and `receivepack` set to `sudo -n -H -u boffin /usr/bin/git-upload-pack` and `sudo -n -H -u boffin /usr/bin/git-receive-pack`.
- **SSH access fails:** this is outside this skill's scope. SSH (including the public key) is part of the already-configured deployment environment: check the operator's local SSH config and keys, or use the provider's out-of-band console. Do not install keys or edit `sshd_config` as part of a Boffin deploy, and do not add an SSH key for the `boffin` account as a workaround.
- **Git identity missing:** also pre-configured environment, not deployment work. Have the operator configure `user.name` / `user.email` for their account, then redo the copy to `boffin` in step 3 — the agent cannot commit without it.

## Risks to state to the operator

- The agent runs as the dedicated `boffin` user with auto-approve (`--force` / `--always-approve` / `--auto`): it can read `config.json`, `data/state.json` (passkeys, conversation), and the CLI credentials in `/home/boffin`, run arbitrary commands as `boffin`, and edit Boffin's own source. The dedicated user protects the operator's account (including its SSH keys and `sudo`) and root — not the app itself.
- The window between Caddy going live (step 7) and owner passkey enrollment (step 8) is the one exposed moment: enrollment is gated by the generated password and rate limits, but enroll immediately.
- `<hostname>` is permanent as far as passkeys are concerned: changing the server's hostname orphans all enrolled passkeys.
- Never run `git` inside `/srv/boffin` as `<github-username>` or `root`, and never bypass `remote.deploy.uploadpack` / `remote.deploy.receivepack`: because `boffin` owns `/srv/boffin/.git`, running git there as a higher-privileged account would execute `boffin`-writable hooks or config under that account.
