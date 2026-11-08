# Boffin

A mobile-friendly chat web UI for the Cursor Agent CLI (`agent`), bound to a fixed working directory and model. You chat with the agent from your browser; it reads, edits, and commits files in its working directory on the machine Boffin runs on.

> **Know what you are running.** Boffin spawns `agent --force` (see `src/agent.js`) as the user running the server. The agent can run commands and edit any file that user can touch — including, if the working directory is this repository, Boffin's own source. Run it as a dedicated unprivileged user (production does; see below), on a machine (or directory) you are comfortable letting an agent modify. See [Security model](#security-model).

## How it works

```mermaid
flowchart LR
    Browser["Browser"] -->|"HTTPS"| Proxy["Reverse proxy (production)"]
    Proxy -->|"127.0.0.1:8080 plain HTTP + X-Forwarded-For"| Boffin["Boffin (Node.js, zero dependencies)"]
    Boffin -->|"spawns agent --force"| Agent["Cursor Agent CLI"]
    Agent -->|"edits and commits"| Workdir["Working directory"]
```

- The server (`src/index.js`, `src/server.js`) serves the web UI, authenticates users with passkeys, and streams agent replies to the browser.
- Each chat message runs the Cursor Agent CLI in the configured working directory with the configured model (`src/agent.js`, `src/conversation.js`). Conversation state is persisted to a JSON state file in the working directory.
- In production, Boffin binds to loopback only and a reverse proxy (Caddy) is the sole public entry point: it terminates TLS, which passkeys require, and overwrites `X-Forwarded-For` so per-client rate limiting works behind the proxy (see `src/attempt-limit.js`).

## Requirements

- **Node.js ≥ 20** (see `engines` in `package.json`). Boffin has no npm dependencies, so there is nothing to install.
- **Cursor Agent CLI** installed and authenticated for the user that will run Boffin:
  ```bash
  curl https://cursor.com/install -fsS | bash   # installs ~/.local/bin/agent
  agent login                                    # or configure an API key per Cursor's docs
  agent status                                   # verify you are signed in
  ```
- **Git**, if the agent should commit its work in the working directory (recommended).
- For production: a **Debian 13 (trixie)** server reached by a fully qualified hostname, with an account named after your GitHub username whose SSH public-key access and git identity are already configured, and which has `sudo` (details under [Deploying to production](#deploying-to-production)). Other hosts work for local use, but the deployment skill targets this environment.

## Quick start (local)

```bash
git clone <this-repository-url> boffin
cd boffin
cp config.example.json config.json
# Edit config.json: set at least username, password, and model.
node src/index.js "$PWD"
```

Then open <http://localhost:8080> (or the `host`/`port` you configured), sign in with the configured username and password, and create your owner passkey. Passkeys work over `http://localhost`; any other hostname needs HTTPS.

Notes:

- The first argument is the **working directory** the agent operates in; omit it to use the current directory. `config.json` must live in that directory. The directory is created if missing.
- If `config.json` is missing, Boffin writes one with safe defaults (username `boffin`, a randomly generated password, mode `0600`) and logs that it did — read the password from the file to sign in.
- `npm start` is shorthand for `node src/index.js` with the current directory as the working directory.
- The configured username/password are only a bootstrap credential for first-time owner passkey enrollment. Once an owner passkey exists, the server retires the password ("The password is no longer used") and sign-in is passkey-only. Enroll promptly after first exposing the server, and keep the hostname stable afterwards: changing it orphans existing passkeys.

## Configuration

`config.json` in the working directory (see `config.example.json` and `src/config.js`). Unknown keys are rejected, as is a `workdir` key — the working directory is the config file's location.

| Key | Default | Meaning |
| --- | --- | --- |
| `host` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` behind a reverse proxy. |
| `port` | `8080` | Port to listen on. |
| `model` | *(required; example uses `composer-2.5`)* | Model passed to `agent --model`. |
| `agent_bin` | `agent` | Path to the Cursor Agent CLI. Use an absolute path under systemd or other minimal environments. In production this is `/home/boffin/.local/bin/agent`. |
| `force` | `true` | Pass `--force` to the agent (auto-approve its actions). |
| `username` | *(required\*)* | Bootstrap username for first passkey enrollment. Must not contain a colon. |
| `password` | *(required\*)* | Bootstrap password, at least 8 characters. Keep `config.json` at mode `0600`. |
| `state_file` | `data/state.json` | Conversation/passkey state, resolved relative to the working directory. |

\* `username`/`password` can instead come from the `BOFFIN_USERNAME` / `BOFFIN_PASSWORD` environment variables, which override the file. `config.json` and `data/` are git-ignored and must never be committed.

## Deploying to production

The deployment assumes an environment that is **already configured** — the skill does not set any of this up:

- You have a Debian 13 (trixie) server known by a fully qualified **hostname**, used for both SSH and the Boffin service (`https://<hostname>`). Passkeys bind to that hostname, so it must be final.
- Your account on the server has the **same name as your GitHub username**, SSH **public-key login to `<github-username>@<hostname>` already works**, a **git identity is already configured** (locally and for that account on the server), and the account has **`sudo`**. Your GitHub username is used **only for SSH** — logging in to administer the server, and git-over-SSH pushes when deploying or upgrading the Boffin source. It is not the account the service runs as.
- The **firewall is already configured** (on the host and/or at the provider) to permit SSH, 80, and 443. The deployment does not install, enable, or modify any firewall rules.

The production topology is: **Caddy** (public 80/443, automatic Let's Encrypt TLS) → **Boffin** as a systemd service running as a dedicated **`boffin` user**, bound to `127.0.0.1:8080`, with the deployed repository at `/srv/boffin` (owned by `boffin`) as both the service's working directory and the agent's working directory. The Cursor Agent CLI is likewise installed and authenticated as `boffin` (credentials in `/home/boffin`); the deployment skill copies your pre-configured git identity to that account so the agent's commits carry it. The pre-configured firewall is left exactly as it is — the deployment adds no rules, and port 8080 needs none because Boffin is loopback-only behind Caddy. You never SSH in as `boffin` — administration is over your own account plus `sudo -u boffin`.

Code updates are pushed over SSH as your own account into that checked-out repository (`receive.denyCurrentBranch=updateInstead`). The repo stays owned by `boffin:boffin` permanently — there is no `chown` handover — because both accounts are members of the shared **`boffin` group** and the tree is group-writable: setgid directories, `core.sharedRepository=group`, a `UMask=0002` on the service so agent-created files are group-writable, and a post-push `chmod g+w` on the files your push checked out. File ownership inside the tree is a harmless mix of the two users; the group is the permission boundary. The skill spells out the exact setup and the per-update steps.

Full step-by-step deployment — precondition checks, service and proxy setup, verification, updating, rollback, and troubleshooting — is provided as an **agent skill**:

- **[`.agents/skills/deploy-boffin/SKILL.md`](.agents/skills/deploy-boffin/SKILL.md)** — a generic [Agent Skill](https://agentskills.io) (not tied to any one vendor's agent). Point any skills-capable coding agent at it and tell it three things — **your GitHub username (for SSH only), your deployment server hostname, and the Cursor Agent model** — and it will deploy Boffin to your server. Human operators can also follow it as a checklist: every step is a plain shell procedure with its own verification.

Day-to-day operations after deployment (over `ssh <github-username>@<hostname>`):

```bash
sudo systemctl restart boffin   # apply code/config changes (the agent cannot do this itself)
journalctl -u boffin -f         # follow service logs
sudo systemctl reload caddy     # after editing /etc/caddy/Caddyfile
```

- **Update:** `git pull --rebase deploy main` (pick up any commits the agent made), `git push deploy HEAD:main`, then on the server re-grant group write on the files your push checked out (`find /srv/boffin -user <github-username> -exec chmod g+w {} +`) and restart the service. A push is refused if the server working tree has uncommitted changes — settle the agent's edits as `boffin` first (details in the skill); the service does not need to be stopped for an update. Never copy files over `/srv/boffin` with `rsync`/`scp`; it would overwrite the agent's work and its `.git`.
- **Recover from a bad agent edit:** over SSH, inspect `sudo -u boffin git -C /srv/boffin log`, `git reset --hard <good-commit>` (or `git revert`) as `boffin`, then restart the service. Uncommitted breakage: `sudo -u boffin git -C /srv/boffin checkout -- .`.

## Security model

- **Agent blast radius.** With `force: true`, the agent executes with the full privileges of the `boffin` service user: it can read `config.json`, the state file (passkeys and conversation), and the Cursor credentials in `/home/boffin`, and run arbitrary commands as `boffin`. The dedicated user protects the rest of the system — your own account (and its SSH keys and `sudo`) and root — not the app. Only give Boffin a working directory you accept an agent may modify destructively; git history in that directory is your recovery path.
- **Authentication.** The bootstrap password only enrolls the first owner passkey and is then retired. Additional members join via owner-issued invite links and their own passkeys. Password attempts are limited to 8 and passkey attempts to 30 per client address per 15 minutes (in-memory; a restart clears the counters).
- **`X-Forwarded-For` trust.** Rate limiting keys on the real client address. Boffin trusts `X-Forwarded-For` only from loopback peers and only takes the last entry, and the production Caddy config overwrites the header with the real peer — so this is safe only while Boffin stays loopback-only behind that proxy. If you change `host` or the proxy topology, re-read `src/attempt-limit.js` first. (Any local process, including the agent, can connect over loopback and choose its own header value; it can already read the credentials in `config.json`, so this adds no exposure.)
- **SSH and git identity are yours, pre-configured.** The deployment procedure never installs keys, edits `sshd_config`, or invents a git identity; it verifies that `ssh <github-username>@<hostname>` works and that an identity exists, copies that identity to the `boffin` account for the agent's commits, and stops if either is missing. No SSH key is added for `boffin` — your account (via `sudo`) is the only administrative path in.

## Development

```bash
node --test   # run the test suite (Node's built-in runner; no dependencies to install)
```

Layout: `src/` is the server, `public/` the web UI, `shared/` code shared by both, and `test/` the tests. `fixtures/fake-agent.js` stands in for the real `agent` CLI in tests.
