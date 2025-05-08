require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { geocodeAddress } = require('../server/utils/geocode');
const { processMobilizeEvents } = require('../server/utils/processMobilizeEvents');

const RAW_DIR = './data/raw';
const OUTPUT_PATH = './data/processed/processed-mobilize.json';
const CUTOFF_TIME = Date.now();

async function run() {
  try {
    const files = await fs.readdir(RAW_DIR);
    const chunkFiles = files.filter(f => f.startsWith('all-mobilize-page') && f.endsWith('.json'));

    let allEvents = [];
    for (const file of chunkFiles) {
      console.log(`📂 Reading ${file}`);
      const raw = await fs.readFile(path.join(RAW_DIR, file), 'utf-8');
      const events = JSON.parse(raw);
      allEvents.push(...events);
    }

    const processed = await processMobilizeEvents(allEvents, CUTOFF_TIME);
    const included = processed.filter(e => e.action === 'included');

    await fs.writeFile(OUTPUT_PATH, JSON.stringify(included, null, 2), 'utf-8');
    console.log(`✅ Saved ${included.length} processed Mobilize events to ${OUTPUT_PATH}`);

  } catch (err) {
    console.error('❌ Error processing Mobilize events:', err);
  }
}

run();
