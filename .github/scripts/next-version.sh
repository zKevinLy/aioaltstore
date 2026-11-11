#!/usr/bin/env bash
# Prints the next release tag (vX.Y.Z) for the commits since the last v* tag.
#
# Conventional Commits decide the bump (the highest one in the range wins):
#   feat!: ... / fix(scope)!: ...  or a "BREAKING CHANGE:" footer  -> major
#   feat: ... / feat(scope): ...                                   -> minor
#   anything else (fix:, deps:, chore:, docs:, no prefix, ...)     -> patch
#
# The git tag is the source of truth. package.json is only read as the starting
# point when no v* tag exists yet.
#
# Usage: next-version.sh [commit-ish]   (default: HEAD)
# Needs full history and tags (actions/checkout: fetch-depth 0, fetch-tags true).
set -euo pipefail

SHA="${1:-HEAD}"

LAST="$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"

if [ -z "$LAST" ]; then
  # First release: start from package.json and only look at the latest commit.
  LAST="v$(node -p "require('./package.json').version")"
  RANGE=(-1 "$SHA")
else
  RANGE=("$LAST..$SHA")
fi

SUBJECTS="$(git log --format='%s' "${RANGE[@]}")"
BODIES="$(git log --format='%b' "${RANGE[@]}")"

if printf '%s\n' "$SUBJECTS" | grep -Eiq '^[[:alnum:]_-]+(\([^)]*\))?!:' ||
  printf '%s\n' "$BODIES" | grep -Eq '^[[:space:]]*BREAKING[ -]CHANGE:'; then
  BUMP=major
elif printf '%s\n' "$SUBJECTS" | grep -Eiq '^feat(\([^)]*\))?:'; then
  BUMP=minor
else
  BUMP=patch
fi

IFS=. read -r MAJOR MINOR PATCH <<<"${LAST#v}"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

TAG="v${MAJOR}.${MINOR}.${PATCH}"
echo "Previous: ${LAST} -> Next: ${TAG} (${BUMP})" >&2
echo "$TAG"
