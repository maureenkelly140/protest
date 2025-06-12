// scripts/split-event-details.js

const fs = require('fs/promises');
const path = require('path');

const sources = [
  { name: 'mobilize', file: 'processed/mobilize-events.json' },
  { name: 'blop', file: 'processed/blop-events.json' },
  { name: 'manual', file: 'processed/manual-protests.json' },
];

async function run() {
  const allLocations = [];
  const eventLookup = {};

  for (const source of sources) {
    const fullPath = path.resolve(__dirname, '..', source.file);

    try {
      console.log(`📖 Reading ${source.name} events...`);
      const raw = await fs.readFile(fullPath, 'utf-8');
      const events = JSON.parse(raw);

      for (const event of events) {
        const { id, start_date, location } = event;
        const lat = location?.lat;
        const lng = location?.lng;

        if (id && lat && lng && start_date) {
          allLocations.push({
            id,
            lat,
            lng,
            start_date,
            source: source.name,
          });

          eventLookup[id] = event;
        }
      }

    } catch (err) {
      console.error(`❌ Failed to process ${source.name}:`, err);
    }
  }

  const locPath = path.resolve(__dirname, '..', 'processed/event-locations.json');
  const lookupPath = path.resolve(__dirname, '..', 'processed/event-lookup.json');

  await fs.writeFile(locPath, JSON.stringify(allLocations, null, 2));
  await fs.writeFile(lookupPath, JSON.stringify(eventLookup, null, 2));

  console.log(`✅ Wrote ${allLocations.length} locations to event-locations.json`);
  console.log(`✅ Wrote ${Object.keys(eventLookup).length} entries to event-lookup.json`);
}

run();
