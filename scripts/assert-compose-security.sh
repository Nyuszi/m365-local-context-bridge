#!/usr/bin/env bash
# Assert docker/compose.yaml meets security requirements.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${ROOT}/docker/compose.yaml"
[[ -f "$FILE" ]] || { echo "missing $FILE"; exit 1; }

fail=0
assert_grep() {
  local pat="$1" msg="$2"
  if ! grep -Eq "$pat" "$FILE"; then
    echo "FAIL: $msg (pattern: $pat)"
    fail=1
  else
    echo "OK: $msg"
  fi
}
assert_not_grep() {
  local pat="$1" msg="$2"
  if grep -Eq "$pat" "$FILE"; then
    echo "FAIL: $msg"
    fail=1
  else
    echo "OK: $msg"
  fi
}

assert_grep '127\.0\.0\.1:32178:32178' 'loopback port publish'
assert_grep 'no-new-privileges' 'no-new-privileges'
assert_grep 'cap_drop:' 'capabilities dropped'
assert_grep 'read_only:\s*true' 'read-only root filesystem'
assert_grep 'profiles:\s*\["bridge"\]|profiles:\s*\n\s*-\s*bridge' 'bridge profile'
assert_grep 'read_only:\s*true' 'read-only workspace bind (primary mount)'
assert_not_grep 'privileged:\s*true' 'must not use privileged'
assert_not_grep 'network_mode:\s*host' 'must not use host networking'
assert_not_grep 'docker\.sock' 'must not mount docker.sock'

# Stronger check: ALL must be in cap_drop
if ! grep -A5 'cap_drop:' "$FILE" | grep -q 'ALL'; then
  echo "FAIL: cap_drop must include ALL"
  fail=1
else
  echo "OK: cap_drop ALL"
fi

exit "$fail"
