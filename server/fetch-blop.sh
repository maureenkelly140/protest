#!/bin/bash

# === fetch-blop.sh ===
# Downloads the latest Blop event CSV from Google Sheets and saves it to data/raw/blop-latest.csv.
# Used by parse-blop.js to generate blop-events.json for the protest finder site.
#
# To run this script:
#   cd server
#   bash fetch-blop.sh

curl -L -o ../data/raw/blop-latest.csv \
  -H "User-Agent: Mozilla/5.0" \
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT4ejObVvtY9C-dAH5wmUFDOW3K6uRGT6SCZPmr2ZPD1Sh-wb9OEeLj-lvqlUD-MFoDFof4cLGamxlz/pub?gid=0&single=true&output=csv"

node parse-blop.js
