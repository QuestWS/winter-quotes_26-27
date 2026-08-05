#!/usr/bin/env bash
# Quest winter system — stamp a dated local copy of all deployable files.
# Run BEFORE any risky edit:  bash tools/snapshot.sh "why I'm doing this"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
NOTE="${1:-manual snapshot}"
DEST="$ROOT/.snapshots/$STAMP"
mkdir -p "$DEST"
for f in index.html admin/index.html quote-logger-apps-script.gs; do
  if [ -f "$ROOT/$f" ]; then
    mkdir -p "$DEST/$(dirname "$f")"
    cp "$ROOT/$f" "$DEST/$f"
  else
    echo "  (skipped, not present: $f)"
  fi
done
echo "$NOTE" > "$DEST/NOTE.txt"
{
  echo "snapshot: $STAMP"
  echo "note:     $NOTE"
  echo "git head: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'not a git repo')"
} > "$DEST/META.txt"
echo "Snapshot saved: .snapshots/$STAMP"
echo "Restore with:   cp -r .snapshots/$STAMP/* ."
