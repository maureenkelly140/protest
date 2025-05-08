/**
 * process-blop.js
 *
 * Processes the latest Blop event data by:
 *  - Reading the raw CSV file (data/raw/blop-latest.csv)
 *  - Applying geocoding (using a local geocache for efficiency)
 *  - Writing processed event data to data/processed/blop-events.json
 *
 * Typical use:
 * This script is part of the Blop pipeline and is usually called by update-blop-all.sh,
 * which also fetches the latest CSV and uploads processed output to S3.
 *
 * To run manually (after updating the CSV):
 *   node scripts/process-blop.js
 */

const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');
const { geocodeAddress } = require('../server/utils/geocode');

const RAW_CSV_PATH = path.join(__dirname, '../data/raw/blop-latest.csv');
const OUTPUT_PATH = path.join(__dirname, '../data/processed/blop-events.json');
const GEOCACHE_PATH = path.join(__dirname, '../data/cache/blop-geocache.json');

async function processBlopEvents() {
  try {
    const csvText = await fs.readFile(RAW_CSV_PATH, 'utf-8');
    const parsed = Papa.parse(csvText, { header: true });
    const rows = parsed.data;

    const now = Date.now();
    const futureEvents = [];

    let geocache = {};
    try {
      geocache = JSON.parse(await fs.readFile(GEOCACHE_PATH, 'utf8'));
    } catch {
      console.log('No geocache found — starting fresh.');
    }

    for (const row of rows) {
      const uuid = row['UUID'] || row['Canonical UUID'];
      const title = row['Title'];
      const rawDate = row['Date'];
      const rawTime = row['Time'];
      if (!uuid || !title || !rawDate || !rawTime) continue;

      const date = new Date(`${rawDate} ${rawTime}`);
      if (isNaN(date.getTime()) || date.getTime() < now) continue;

      const location = [row['Address'], row['City'], row['State']].filter(Boolean).join(', ');
      if (!location) continue;

      if (!geocache[uuid]) {
        const geo = await geocodeAddress(location);
        if (!geo) continue;
        geocache[uuid] = geo;
      }

      let url = row['Links']?.split(',')[0]?.trim() || '';
      if (url === '' || url === '[]') {
        url = row['Image URL']?.trim() || '';
      }
      const imageUrl = row['Image URL']?.trim() || '';
      const finalUrl = url || imageUrl;

      futureEvents.push({
        title,
        date: date.toISOString(),
        location,
        latitude: geocache[uuid].latitude,
        longitude: geocache[uuid].longitude,
        url: finalUrl,
        approved: true,
        source: 'blop'
      });
    }

    await fs.writeFile(OUTPUT_PATH, JSON.stringify(futureEvents, null, 2));
    await fs.writeFile(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));

    console.log(`✅ Processed BLOP events saved: ${futureEvents.length}`);
  } catch (err) {
    console.error('❌ Error processing BLOP events:', err);
  }
}

processBlopEvents();
