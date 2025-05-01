#!/bin/bash
curl -L -o data/blop-latest.csv \
  -H "User-Agent: Mozilla/5.0" \
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT4ejObVvtY9C-dAH5wmUFDOW3K6uRGT6SCZPmr2ZPD1Sh-wb9OEeLj-lvqlUD-MFoDFof4cLGamxlz/pub?gid=0&single=true&output=csv"

node parse-blop.js
