---
name: deploy
description: >-
  Verify, package, and deploy the chiang-mile Speed app to the Speed (speed.so)
  platform. Use when the user asks to deploy or package chiang-mile for Speed.
---

# Deploy `chiang-mile` to Speed (`speed.so`)

All commands below run from `chiang-mile/` unless noted otherwise.

## 1. Pre-deploy checks

Run the test suite (and typecheck when `tsgo` is available):

```bash
./node_modules/.bin/vitest run
# When pnpm / @typescript/native-preview tsgo is available:
pnpm check
```

Do not deploy if any test fails.

## 2. Credentials and app ID (outside the repo)

Never store Speed tokens or app IDs in git. Keep them under `~/.config/speed/` (directory mode `700`). The files are mode `600`:

- `~/.config/speed/token` — Speed personal access token (also exported as `$SPEED_TOKEN` in `~/.bashrc`)
- `~/.config/speed/chiang-mile` — Speed app ID (corresponding to `https://chiangmile.spdso.app`)

```bash
set -euo pipefail
SPEED_TOKEN="${SPEED_TOKEN:-$(cat ~/.config/speed/token)}"
APP_ID="$(tr -d '[:space:]' < ~/.config/speed/chiang-mile)"
```

## 3. Package the source tarball

`chiang-mile` is a Speed startkit app (`rsbuild` frontend, Hono API in `api/`, Drizzle SQLite schema in `db/schema.ts`).

Create a `.tar.gz` archive from inside `chiang-mile/` so `package.json` is at the archive root, excluding runtime/platform files:

- `.data/` (persistent runtime SQLite DB and `.data/wiki.html` cache)
- `dist/`, `node_modules/`, `.pnpm-store/`, `.git/`, `storybook-static/`
- `public/speed-sdk.js`, `public/speed-service-worker.js`, and `public/_speed/` (served by the Speed edge proxy in production; do not upload local copies)

`COPYFILE_DISABLE=1` and `--no-xattrs` keep macOS `com.apple.provenance` extended attributes and AppleDouble `._` files out of the archive.

```bash
set -euo pipefail
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/chiang-mile-source.tar.gz \
  --exclude='./.data' --exclude='./dist' --exclude='./node_modules' \
  --exclude='./.pnpm-store' --exclude='./.git' --exclude='./storybook-static' \
  --exclude='./public/speed-sdk.js' --exclude='./public/speed-service-worker.js' \
  --exclude='./public/_speed' \
  .
```

## 4. Upload and deploy via `api.speed.so`

The startkit image mounts `../framework` (`speed-framework` is a `file:` dependency) and `/tmp/framework/db-apply.ts`. Do not vendor them into the archive. In the container, Speed runs `pnpm install`, `pnpm run build`, and `pnpm run db:apply` (pending migrations, then a push of `db/schema.ts`).

If a local `pnpm run db:apply` reports an ambiguous schema change (a rename drizzle-kit cannot tell from a drop plus add), write the SQL with `pnpm run db:migration:create <name>` and apply it before packaging. Production push can drop a renamed column that is not in a migration.

1. Upload the tarball to create a checkpoint:

```bash
set -euo pipefail
curl -sS -f \
  -X POST "https://api.speed.so/api/apps/$APP_ID/upload-source?title=chiang-mile%20deploy" \
  -H "Authorization: Bearer $SPEED_TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary @/tmp/chiang-mile-source.tar.gz \
  -o /tmp/speed-upload.json
CHECKPOINT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/speed-upload.json"))["checkpointId"])')"
```

2. Trigger deployment of that checkpoint and poll until `completed` or `failed` (60 attempts, 10 seconds apart):

```bash
set -euo pipefail
DEPLOY_ID="$(curl -sS -f -X PUT "https://api.speed.so/api/apps/$APP_ID/deploy?checkpointId=$CHECKPOINT_ID" \
  -H "Authorization: Bearer $SPEED_TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployId"])')"

STATUS=""
done_ok=
for _ in $(seq 1 60); do
  if ! STATUS="$(curl -sS -f -H "Authorization: Bearer $SPEED_TOKEN" \
      "https://api.speed.so/api/apps/$APP_ID/deploy/$DEPLOY_ID" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"], d.get("error") or "")')"; then
    echo "status request failed" >&2
    sleep 10
    continue
  fi
  echo "$STATUS"
  case "$STATUS" in
    completed*) done_ok=1; break ;;
    failed*) exit 1 ;;
  esac
  sleep 10
done
if [ -z "${done_ok}" ]; then
  echo "deploy not complete: ${STATUS:-no status}" >&2
  exit 1
fi
```

3. Smoke-test `/`, `/api/wiki/html`, `/api/wiki/history`, and `/api/wiki/edit` on `https://chiangmile.spdso.app`.
