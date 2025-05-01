const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');

const GEOCACHE_PATH = path.join(__dirname, 'blop-geocache.json');
const CACHE_PATH = path.join(__dirname, 'blop-events.json');

// Dummy geocode function — replace with real one if needed
async function geocodeAddress(address) {
  return { latitude: 0, longitude: 0 }; // Replace this with real logic
}

async function syncBlopEvents() {
  try {
    const localCsvPath = path.join(__dirname, 'data/blop-latest.csv');
    const csvText = await fs.readFile(localCsvPath, 'utf-8');
    const parsed = Papa.parse(csvText, { header: true });
    const rows = parsed.data;

    const now = Date.now();
    const futureEvents = [];

    let geocache = {};
    try {
      geocache = JSON.parse(await fs.readFile(GEOCACHE_PATH, 'utf8'));
    } catch (err) {
      console.log('No geocache found. Starting fresh.');
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

      // Use imageUrl if url is missing
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

    await fs.writeFile(CACHE_PATH, JSON.stringify(futureEvents, null, 2));
    await fs.writeFile(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));

    console.log(`✅ BLOP events saved: ${futureEvents.length}`);
  } catch (err) {
    console.error('❌ Error parsing BLOP CSV:', err);
  }
}

syncBlopEvents();
