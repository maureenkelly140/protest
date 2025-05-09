#!/bin/bash
set -e

# === update-blop-all.sh ===
# Runs the full Blop pipeline:
# 1. Fetch latest CSV (and upload to S3)
# 2. Process it into JSON (which uploads separately)

# Determine project root relative to this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Load environment variables
source "$PROJECT_ROOT/.env"

echo "🌐 Fetching latest Blop CSV..."
node "$PROJECT_ROOT/scripts/fetch-blop.js"

echo "🔧 Processing Blop CSV into JSON..."
node "$PROJECT_ROOT/scripts/process-blop.js"

echo "✅ All done!"
