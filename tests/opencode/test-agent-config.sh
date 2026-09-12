#!/usr/bin/env bash
# Test: Agent config merge (superpowers.jsonc)
# Verifies the plugin's config hook merges agents from superpowers.jsonc
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Test: Agent Config Merge ==="

node "$SCRIPT_DIR/test-agent-config.mjs" "$(cd "$SCRIPT_DIR/../.." && pwd)/.opencode/plugins/superpowers.js"

echo ""
echo "=== All agent config tests passed ==="