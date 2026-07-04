#!/usr/bin/env bash
# Deregisters the cloudstash-sync LaunchAgent. Idempotent.
set -euo pipefail

LABEL="com.cloudstash.sync"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "cloudstash-sync: LaunchAgent deregistered (if present)"
