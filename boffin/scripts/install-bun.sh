#!/usr/bin/env bash
# Install Bun from GitHub releases without requiring the unzip package: unzip when
# present, otherwise python3's zipfile module.
# This script is not needed once https://github.com/oven-sh/bun/pull/43643 is merged.
set -euo pipefail

error() {
  echo "error: $*" >&2
  exit 1
}

extract_zip() {
  local archive="$1"
  local dest="$2"
  if command -v unzip >/dev/null 2>&1; then
    local names name rest part
    names=$(unzip -Z1 "$archive") || error "could not list \"$archive\""
    while IFS= read -r name || [[ -n "$name" ]]; do
      [[ -z "$name" ]] && continue
      case "$name" in
        /*) error "refusing to extract \"$name\"" ;;
      esac
      rest="$name"
      while [[ -n "$rest" ]]; do
        part="${rest%%/*}"
        if [[ "$part" == ".." ]]; then
          error "refusing to extract \"$name\""
        fi
        if [[ "$rest" == */* ]]; then
          rest="${rest#*/}"
        else
          rest=
        fi
      done
    done <<< "$names"
    unzip -oqd "$dest" "$archive"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$archive" "$dest" <<'PY'
import pathlib
import sys
import zipfile

archive, dest = sys.argv[1], pathlib.Path(sys.argv[2])
dest.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as zf:
    for name in zf.namelist():
        parts = name.split('/')
        if name.startswith('/') or any(part == '..' for part in parts):
            raise SystemExit(f'refusing to extract {name}')
    zf.extractall(dest)
PY
    return
  fi
  error 'unzip or python3 is required to install bun'
}

platform=$(uname -ms)
case $platform in
  'Linux aarch64' | 'Linux arm64') target=linux-aarch64 ;;
  'Linux x86_64' | 'Linux amd64') target=linux-x64 ;;
  *) error "unsupported platform: $platform" ;;
esac

case $target in
  linux-*)
    if [[ -f /etc/alpine-release ]]; then
      target="$target-musl"
    fi
    ;;
esac

case $target in
  linux-x64*)
    if [[ -r /proc/cpuinfo ]] && ! grep -q avx2 /proc/cpuinfo; then
      target="$target-baseline"
    fi
    ;;
esac

github_repo="${GITHUB:-https://github.com}/oven-sh/bun"
if [[ $# -eq 0 ]]; then
  bun_uri="$github_repo/releases/latest/download/bun-$target.zip"
else
  bun_uri="$github_repo/releases/download/$1/bun-$target.zip"
fi

install_dir="${BUN_INSTALL:-$HOME/.bun}"
bin_dir="$install_dir/bin"
exe="$bin_dir/bun"
bundle_dir="$bin_dir/bun-$target"
if ! command -v sha256sum >/dev/null 2>&1; then
  error 'sha256sum is required to install bun'
fi

zip_file="$(mktemp "${TMPDIR:-/tmp}/bun-XXXXXX.zip")"
sums_file="$(mktemp "${TMPDIR:-/tmp}/bun-XXXXXX.txt")"
cleanup() {
  rm -f "$zip_file" "$sums_file"
}
trap cleanup EXIT

mkdir -p "$bin_dir"
# latest/download redirects to releases/download/<tag>/, then to the file host.
# The checksum list is published next to that tag, not on the file host.
release_url=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --fail --output /dev/null --write-out '%{redirect_url}' "$bun_uri") ||
  error "Failed to resolve bun download URL \"$bun_uri\""
case "$release_url" in
  "$github_repo"/releases/download/*/*)
    bun_uri="$release_url"
    ;;
  *)
    # latest/download must land on the tag URL so checksums sit beside the zip.
    # A versioned URL is already that path; a later hop to the file host is fine.
    if [[ $# -eq 0 ]]; then
      error "Failed to resolve bun download URL \"$bun_uri\""
    fi
    ;;
esac
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --progress-bar --output "$zip_file" "$bun_uri" ||
  error "Failed to download bun from \"$bun_uri\""
sums_uri="${bun_uri%/*}/SHASUMS256.txt"
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --silent --show-error --output "$sums_file" "$sums_uri" ||
  error "Failed to download checksums from \"$sums_uri\""
expected=$(awk -v name="bun-${target}.zip" '
  {
    file = $2
    sub(/\r$/, "", file)
    sub(/^\*/, "", file)
    if (file == name) {
      print $1
    }
  }
' "$sums_file")
if [[ ! "$expected" =~ ^[0-9a-fA-F]{64}$ ]]; then
  error "checksum list has no single entry for bun-${target}.zip"
fi
actual=$(sha256sum "$zip_file")
actual=${actual%% *}
if [[ "$actual" != "$expected" ]]; then
  error "checksum mismatch for bun-${target}.zip"
fi

extract_zip "$zip_file" "$bin_dir"

if [[ ! -f "$bundle_dir/bun" ]]; then
  error "Expected \"$bundle_dir/bun\" after extracting the archive"
fi

chmod +x "$bundle_dir/bun"
mv -f "$bundle_dir/bun" "$exe"
chmod +x "$exe"
rm -rf "$bundle_dir"

echo "bun was installed to $exe"
if [[ -x "$exe" ]]; then
  "$exe" --version
fi
