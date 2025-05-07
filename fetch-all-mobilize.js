/**
 * fetch-all-mobilize.js
 *
 * This script fetches ALL available Mobilize events using pagination,
 * collects them into a single array, and writes the result to:
 *   data/raw/all-mobilize-events.json
 *
 * You can run this script manually by navigating to your project root
 * and running:
 *   node fetch-all-mobilize.js
 *
 * Typical use case: Run periodically (manually or via a cron job) to
 * refresh the full Mobilize event dataset. The main Express server can
 * then read from the saved JSON file instead of live-pulling thousands
 * of events on every page load.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

const OUTPUT_DIR = './data/raw/';
const BASE_URL = 'https://api.mobilize.us/v1/events?timeslot_start=gte_now';
const PER_PAGE = 200;

async function cleanupOldChunks() {
  const files = await fs.readdir(OUTPUT_DIR);
  const oldChunks = files.filter(f => f.startsWith('all-mobilize-page') && f.endsWith('.json'));

  for (const file of oldChunks) {
    await fs.unlink(path.join(OUTPUT_DIR, file));
    console.log(`🗑️ Deleted old chunk: ${file}`);
  }
}

async function fetchAllMobilizeEvents() {
  let url = `${BASE_URL}&per_page=${PER_PAGE}`;
  let page = 1;

  try {
    await cleanupOldChunks();

    while (url) {
      console.log(`📥 Fetching page ${page}: ${url}`);
      const res = await fetch(url);
      const json = await res.json();

      if (json.data && Array.isArray(json.data)) {
        const chunkPath = `${OUTPUT_DIR}all-mobilize-page${page}.json`;
        await fs.writeFile(chunkPath, JSON.stringify(json.data, null, 2), 'utf-8');
        console.log(`💾 Saved page ${page} to ${chunkPath}`);
      } else {
        console.warn(`⚠️ Unexpected data format on page ${page}`);
        break;
      }

      if (json.next) {
        url = json.next;
        page++;
      } else {
        url = null;
      }
    }

    console.log(`✅ Finished fetching ${page - 1} pages`);

  } catch (err) {
    console.error('❌ Error fetching Mobilize events:', err);
  }
}

fetchAllMobilizeEvents();