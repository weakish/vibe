# CircleCI: deploy-only (Origin → Linux server)

This repository can deploy **only on pushes to `mvp`**: CircleCI checks out the commit from [Cursor Origin](https://cursor.com/docs/origin/apps), runs `scripts/circleci-deploy.sh`, and that script **git-pushes over SSH** into `/srv/boffin` on your production host (fast-forward onto the server's `main` checkout), then **re-grants group write** on operator-owned files and **`systemctl restart boffin`**. It follows the same rules as manual deploys in [`.agents/skills/deploy-boffin/SKILL.md`](../.agents/skills/deploy-boffin/SKILL.md) (fast-forward only; push fails if the server tree is dirty).

There is **no test job** in this pipeline—only deploy.

## Prerequisites

- Boffin is **already installed** on the server (deploy skill steps 1–8 completed).
- `/srv/boffin` is a git working copy with `receive.denyCurrentBranch updateInstead` and shared `boffin` group permissions.
- The operator SSH account can `git push` to `/srv/boffin` and run `sudo systemctl restart boffin` without a password prompt (or deploy will fail at restart).
- This repo is **Origin-hosted** (not a GitHub mirror). Connect the project in CircleCI via the [Origin integration](https://circleci.com/integrations/origin/).

## One-time CircleCI setup

1. Install the **CircleCI** app from the Origin **Apps** tab (authorize the Origin org), then in CircleCI create the project and select this repository. CircleCI cannot commit `.circleci/config.yml` for you on Origin — it must already be in the repo.
2. **Project environment variables** (Project Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `DEPLOY_SSH_USER` | SSH login on the server (same as `<github-username>` in the deploy skill) |
   | `DEPLOY_HOST` | FQDN used for SSH (e.g. `boffin.example.com`) |
   | `DEPLOY_SSH_KNOWN_HOSTS` | Optional. `ssh-keyscan`-format host-key lines for `DEPLOY_HOST`. If unset, the script TOFU-scans the host on each job. |

3. **Deploy SSH key** (Project Settings → SSH Keys → Additional SSH Keys):

   - Generate an ed25519 key pair used **only** for this deploy.
   - Append the **public** key to `~/.ssh/authorized_keys` for `DEPLOY_SSH_USER` on the server.
   - Add the **private** key in CircleCI. Set **Hostname** to `DEPLOY_HOST` so the key is not offered to other hosts.
   - Copy the key’s **SHA256** fingerprint from the UI.

4. Edit [`.circleci/config.yml`](../.circleci/config.yml): replace `SHA256:REPLACE_WITH_DEPLOY_KEY_FINGERPRINT` with that fingerprint.

After a push to `mvp`, the **deploy-production** workflow runs automatically. Status is reported to Origin if the integration’s checks are enabled for the project. The server working branch stays `main`; the job updates that ref with the `mvp` commit.

## CircleCI vs Buildkite (SSH deploy only)

Focused on **deploying this repo to a Linux VPS over SSH** after pushes to `mvp`—not PR tests, macOS runners, or general platform features.

| | **CircleCI (this setup)** | **Buildkite (typical equivalent)** |
| --- | --- | --- |
| **Config** | `.circleci/config.yml` + `scripts/circleci-deploy.sh` | `pipeline.yml` + a similar shell script |
| **Origin** | [Origin integration](https://circleci.com/integrations/origin/); checkout from Origin | [Origin source provider](https://buildkite.com/docs/pipelines/source-control/origin) |
| **Deploy SSH key** | **Additional SSH Keys** with optional **per-hostname** binding ([docs](https://circleci.com/docs/guides/integration/add-ssh-key/)) | **Buildkite secrets** + `ssh` in a `command:` step ([docs](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets)) |
| **Deploy how-to** | First-party [Deploy over SSH](https://circleci.com/docs/guides/deploy/deploy-over-ssh/) matches this pattern | No single “deploy over SSH” page; you assemble the same bash |
| **Free tier for occasional deploys** | Credits/month ([pricing](https://circleci.com/pricing/)); a short Docker job every push is usually enough | **2,000 Linux vCPU‑minutes/month** on the [Free plan](https://buildkite.com/pricing/) |
| **Self-hosted runner** | Supported; useful if the VPS is only on a private network | **Self-hosted agent** is a common pattern for the same reason; hosted minutes stay untouched |
| **Operate from one file** | Fingerprint placeholder in `config.yml` must be updated once after adding the key | Pipeline + secret name in the Buildkite UI |

**When CircleCI is a better fit here:** you want **hostname-scoped** deploy keys in project settings and the **official SSH deploy** documentation path; you already use CircleCI.

**When Buildkite is a better fit here:** you want **simpler per-minute free hosting** for a single bash deploy step, or you plan to run a **self-hosted agent** next to the server and avoid paying for cloud egress to SSH.

Both require you to own the same bash semantics (fast-forward push, `chmod g+w`, `systemctl restart`). Neither replaces first-time server setup in the deploy skill.
