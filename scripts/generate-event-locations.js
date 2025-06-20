// scripts/generate-event-locations.js

const fs = require('fs/promises');
const path = require('path');

const SOURCES = [
  { name: 'mobilize', file: 'mobilize-events.json' },
  { name: 'blop', file: 'blop-events.json' },
  { name: 'manual', file: 'manual-protests.json' },
];

const AWS = require('aws-sdk');
require('dotenv').config();

const s3 = new AWS.S3();
const BUCKET_NAME = 'my-protest-finder-data';

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

    await uploadToS3(outPath, 'processed/event-locations.json');
    console.log('☁️ Uploaded event-locations.json to S3');
  } catch (err) {
    console.error('❌ Failed to write event-locations.json:', err);
  }
}

async function uploadToS3(filePath, s3Key) {
  const fileContent = await fs.readFile(filePath);

  const params = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: 'application/json'
  };

  return s3.upload(params).promise();
}

run();
