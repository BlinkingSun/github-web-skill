#!/usr/bin/env bash
# github-web — fetch, validate, render, and (optionally) publish.
#
# Fail-closed by design: if the fetch or validation fails, the page is left
# byte-identical and nothing is published. A half-updated section is worse than
# a stale one, because it looks fine.
#
#   ./sync.sh                 fetch -> validate -> render
#   ./sync.sh --publish       ... then run publish.sh
#   ./sync.sh --dry-run       fetch + validate only, never touch the page
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

# .env is optional on an interactive machine; on a server it is usually the only
# way to supply credentials (see docs/SCHEDULING.md — macOS Keychain does not
# work under launchd).
# Values already in the environment WIN; .env only fills the gaps. `set -a; . .env`
# would do the opposite and silently discard a one-off override such as
# `GITHUB_USER=someone-else ./sync.sh`, which is surprising and hard to spot.
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    [ -n "${!key:-}" ] && continue
    export "$key=${line#*=}"
  done < "$ROOT/.env"
fi

PUBLISH=0; DRY=0
for a in "$@"; do
  case "$a" in
    --publish) PUBLISH=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

: "${GITHUB_USER:?set GITHUB_USER (your github.com/<login> name)}"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN (see docs/API-SETUP.md)}"
: "${TARGETS:?set TARGETS (comma-separated paths to the HTML files to render into)}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
echo "[$(ts)] github-web starting  user=$GITHUB_USER"

# 1. fetch — writes data/github-contributions.json, or restores the last-good copy
node scripts/fetch-github.mjs

# 2. validate — schema + sanity. Exits non-zero on anything suspicious.
node scripts/validate.mjs

if [ "$DRY" = "1" ]; then
  echo "[$(ts)] dry run — page untouched"
  exit 0
fi

# 3. render into the page(s)
TARGETS="$TARGETS" node scripts/render-github.mjs

# 4. optional publish hook — yours to write (git push, rsync, wrangler, scp...)
if [ "$PUBLISH" = "1" ]; then
  if [ -x "$ROOT/publish.sh" ]; then
    "$ROOT/publish.sh"
  else
    echo "  --publish given but ./publish.sh is missing or not executable" >&2
    exit 1
  fi
fi

echo "[$(ts)] done"
