#!/usr/bin/env bash
# Push the checked-out commit to /srv/boffin and restart the Boffin systemd unit.
# Expects DEPLOY_SSH_USER and DEPLOY_HOST in the environment (CircleCI project vars).
# Optional DEPLOY_SSH_KNOWN_HOSTS: ssh-keyscan-format host-key lines (skips TOFU keyscan).
# SSH auth comes from CircleCI "Additional SSH Keys" (add_ssh_keys step in config.yml).

set -euo pipefail

deploy_user="${DEPLOY_SSH_USER:?Set DEPLOY_SSH_USER in CircleCI project environment variables}"
deploy_host="${DEPLOY_HOST:?Set DEPLOY_HOST in CircleCI project environment variables}"
commit="${CIRCLE_SHA1:-HEAD}"

if [[ "${CIRCLE_BRANCH:-}" != "main" ]]; then
  echo "Refusing to deploy: expected branch main, got '${CIRCLE_BRANCH:-unknown}'." >&2
  exit 1
fi

deploy_git="ssh://${deploy_user}@${deploy_host}/srv/boffin"
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
export GIT_SSH_COMMAND="ssh ${ssh_opts[*]}"

mkdir -p ~/.ssh
chmod 700 ~/.ssh
if [[ -n "${DEPLOY_SSH_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
elif ! ssh-keyscan -T 10 "$deploy_host" >> ~/.ssh/known_hosts; then
  echo "ssh-keyscan failed for ${deploy_host}" >&2
  exit 1
fi
chmod 600 ~/.ssh/known_hosts

git remote remove deploy 2>/dev/null || true
git remote add deploy "$deploy_git"

echo "Pushing ${commit} to ${deploy_git} (main)…"
if ! git push deploy "${commit}:refs/heads/main"; then
  cat >&2 <<'EOF'
git push to the server failed. Common causes:
  - The server working tree has uncommitted agent edits (settle as boffin, then retry).
  - The push is not a fast-forward (fetch agent commits from deploy, rebase, push again).
See .agents/skills/deploy-boffin/SKILL.md ("Updating after the first deploy").
EOF
  exit 1
fi

echo "Post-push group permissions and service restart on ${deploy_host}…"
remote_user_q=$(printf '%q' "$deploy_user")
ssh "${ssh_opts[@]}" "${deploy_user}@${deploy_host}" \
  "DEPLOY_SSH_USER=${remote_user_q} bash -s" <<'REMOTE'
set -euo pipefail
find /srv/boffin -user "${DEPLOY_SSH_USER}" -exec chmod g+w {} +
sudo systemctl restart boffin
if ! systemctl is-active --quiet boffin; then
  echo "boffin.service is not active after restart" >&2
  exit 1
fi
REMOTE

echo "Deploy finished: main is live on ${deploy_host}."
