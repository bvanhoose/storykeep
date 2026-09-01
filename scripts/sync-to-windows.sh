#!/usr/bin/env bash
#
# Copy the StoryKeep source over to the Windows side, so the Windows installer
# can be built there (Tauri does not cross-compile).
#
#   ./scripts/sync-to-windows.sh          # sync to D:\Projects\storykeep
#   ./scripts/sync-to-windows.sh -n       # show what would change, copy nothing
#   ./scripts/sync-to-windows.sh /mnt/c/somewhere/else
#
# Build outputs and installed dependencies are deliberately left behind: they
# contain Linux binaries that would break a Windows build. Whatever npm and
# cargo have already put on the Windows side is left alone, so re-syncing after
# an edit is fast.

set -euo pipefail

DEFAULT_DEST="/mnt/d/Projects/storykeep"
DRY_RUN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN="--dry-run"; shift ;;
    -h|--help)    sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           echo "Unknown option: $1" >&2; exit 2 ;;
    *)            DEFAULT_DEST="$1"; shift ;;
  esac
done

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$DEFAULT_DEST"

if [[ ! -d "$(dirname "$DEST")" ]]; then
  echo "The folder $(dirname "$DEST") isn't there." >&2
  echo "Is the drive mounted? Check: ls /mnt" >&2
  exit 1
fi

mkdir -p "$DEST"

# Regenerable or platform-specific. Excluded paths are also protected from
# --delete, so a Windows-side node_modules survives every sync.
EXCLUDES=(
  --exclude "node_modules/"
  --exclude "src-tauri/target/"
  --exclude "src-tauri/gen/"
  --exclude "dist/"
  --exclude ".git/"
  --exclude "*:Zone.Identifier"   # NTFS metadata WSL leaves behind
  --exclude ".DS_Store"
)

echo "  from  $SOURCE"
echo "    to  $DEST"
[[ -n "$DRY_RUN" ]] && echo "  (dry run — nothing will be written)"
echo

# --no-perms/-owner/-group: a DrvFs mount can't hold Unix permissions, and
# asking it to just produces noise.
rsync -rt --delete --human-readable --itemize-changes \
  --no-perms --no-owner --no-group \
  $DRY_RUN "${EXCLUDES[@]}" \
  "$SOURCE/" "$DEST/"

if [[ -n "$DRY_RUN" ]]; then
  echo
  echo "Dry run finished. Re-run without -n to copy."
  exit 0
fi

WIN_PATH="$(sed -E 's#^/mnt/([a-z])/#\U\1:\\#' <<<"$DEST" | tr '/' '\\')"

cat <<EOF

Copied. On Windows, open a terminal in $WIN_PATH and run:

    build                          to build the exe and installers
    build dev                      to work on it there instead

The first Windows build downloads the npm and cargo dependencies again — that
one takes a while. Later syncs reuse them.
EOF
