#!/usr/bin/env bash
#
# Stamp .claude/.last-verify-passed with the identity of the tree that just
# passed `make verify`. Runs as the final step of that target and nowhere
# else — the sentinel is only meaningful because every check ran first.
#
# The hash must match compute_diff_hash() in ~/.claude/hooks/review-gate.sh
# exactly; the two are readers of the same value, and a disagreement denies
# every commit. It is a git tree object built through a throwaway index
# seeded from HEAD, which is what makes it cover untracked files while
# ignoring whatever happens to be staged.
set -euo pipefail

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

git read-tree --index-output="$dir/index" HEAD
GIT_INDEX_FILE="$dir/index" git add -A
hash=$(GIT_INDEX_FILE="$dir/index" git write-tree | cut -c1-16)

mkdir -p .claude
printf '%s\n' "$hash" > .claude/.last-verify-passed
echo "verified $hash"
