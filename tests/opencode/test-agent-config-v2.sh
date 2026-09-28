#!/usr/bin/env bash
# Test: Agent config merge (superpowers.jsonc) on V2 via ctx.agent.transform()
# Verifies the plugin's setup() registers agents from superpowers.jsonc
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Test: Agent Config Merge (V2) ==="

node "$SCRIPT_DIR/test-agent-config-v2.mjs" "$(cd "$SCRIPT_DIR/../.." && pwd)/.opencode/plugins/superpowers.js"

echo ""
echo "=== All V2 agent config tests passed ==="
