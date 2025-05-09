#!/bin/bash

# Resolve script directory (absolute, works locally + remotely)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Change to project root
cd "$PROJECT_ROOT"

# Load .env into shell environment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set paths
NODE_PATH="$(which node)"  # auto-detect node binary
LOG_DIR="$PROJECT_ROOT/logs"

# SAFEGUARD: Check for critical AWS variables
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$S3_BUCKET" ]; then
    echo "❌ Missing critical AWS environment variables! Check your .env or server configuration."
    exit 1
fi

# Make sure log directory exists
mkdir -p "$LOG_DIR"

# Create timestamped log file
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/process-all_$TIMESTAMP.log"

# Run the script and log output
echo "=== Running process-all at $TIMESTAMP ===" >> "$LOG_FILE"
$NODE_PATH "$PROJECT_ROOT/scripts/process-all.js" >> "$LOG_FILE" 2>&1
echo "=== Finished process-all at $(date +"%Y-%m-%d_%H-%M-%S") ===" >> "$LOG_FILE"

echo "=== JOB LOG START ==="
cat "$PROJECT_ROOT/logs/job.log"
echo "=== JOB LOG END ==="
