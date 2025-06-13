// scripts/generate-event-locations.js

const fs = require('fs/promises');
const path = require('path');

const SOURCES = [
  { name: 'mobilize', file: 'mobilize-events.json' },
  { name: 'blop', file: 'blop-events.json' },
  { name: 'manual', file: 'manual-protests.json' },
];

async function run() {
  const allLocations = [];

  for (const source of SOURCES) {
    const filePath = path.join('data', 'processed', source.file);

    try {
      console.log(`📖 Reading ${source.name} events...`);
      const raw = await fs.readFile(filePath, 'utf-8');
      const events = JSON.parse(raw);

      for (const event of events) {
        const id = event.id;
        const lat = event.latitude ?? event.location?.location?.latitude;
        const lng = event.longitude ?? event.location?.location?.longitude;
        const date = event.date || event.timeslots?.[0]?.start_date;

        if (id && lat && lng && date) {
          allLocations.push({
            id,
            lat,
            lng,
            start_date: date,
            source: source.name,
          });
        }
      }
    } catch (err) {
      console.error(`❌ Failed to process ${source.name}:`, err);
    }
  }

  try {
    const outPath = path.join('data', 'processed', 'event-locations.json');
    await fs.writeFile(outPath, JSON.stringify(allLocations, null, 2), 'utf-8');
    console.log(`✅ Wrote ${allLocations.length} locations to event-locations.json`);
  } catch (err) {
    console.error('❌ Failed to write event-locations.json:', err);
  }
}

run();
