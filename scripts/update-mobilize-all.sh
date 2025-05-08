#!/bin/bash
set -e

# === update-mobilize-all.sh ===
# Runs the full Mobilize pipeline:
# 1. Fetch raw Mobilize data (paginated)
# 2. Process and filter it into a cleaned JSON
# 3. Upload the processed file to S3

# Load environment variables (adjust path if needed)
source .env

echo "📥 Fetching raw Mobilize data from API..."
node scripts/fetch-mobilize.js

echo "🔧 Processing Mobilize data..."
node scripts/process-mobilize.js

echo "📤 Uploading processed Mobilize data to S3..."
node scripts/upload-processed-to-s3.js

echo "✅ Mobilize pipeline complete!"
