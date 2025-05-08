#!/bin/bash
set -e

# === update-blop-all.sh ===
# Runs the full Blop pipeline:
# 1. Fetch latest CSV from Google Sheets
# 2. Process it into JSON
# 3. Upload to S3


# Load environment variables
source ../.env

echo "🌐 Fetching latest Blop CSV..."
curl -L -o ../data/raw/blop-latest.csv \
  -H "User-Agent: Mozilla/5.0" \
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT4ejObVvtY9C-dAH5wmUFDOW3K6uRGT6SCZPmr2ZPD1Sh-wb9OEeLj-lvqlUD-MFoDFof4cLGamxlz/pub?gid=0&single=true&output=csv"

echo "🔧 Processing Blop CSV into JSON..."
node process-blop.js

echo "📤 Uploading processed JSON to S3..."
node upload-processed-to-s3.js

echo "✅ All done!"
