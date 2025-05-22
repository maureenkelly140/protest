/**
 * process-blop.js
 *
 * Processes the latest Blop CSV:
 *  - Reads raw CSV from data/raw/blop-latest.csv
 *  - Applies geocoding and filtering
 *  - Writes processed events to data/processed/blop-events.json
 *  - Uploads processed JSON to S3 under processed/blop-events.json
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const Papa = require('papaparse');
const AWS = require('aws-sdk');
const { geocodeAddress } = require('../server/utils/geocode');

const RAW_CSV_PATH = path.join(__dirname, '../data/raw/blop-latest.csv');
const OUTPUT_PATH = path.join(__dirname, '../data/processed/blop-events.json');
const GEOCACHE_PATH = path.join(__dirname, '../data/cache/blop-geocache.json');
const OUTPUT_S3_KEY = 'processed/blop-events.json';

const BUCKET_NAME = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'us-west-1';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: REGION,
});

const s3 = new AWS.S3();

async function uploadToS3(filePath, key) {
  const fileContent = await fs.readFile(filePath);
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileContent,
    ContentType: 'application/json',
  };
  await s3.upload(params).promise();
  console.log(`✅ Uploaded ${key} to S3 bucket ${BUCKET_NAME}`);
}

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
    
      // Use Image URL as the main link
      const url = row['Image URL']?.trim() || '';
    
      futureEvents.push({
        id: uuid.toString(),
        title,
        date: date.toISOString(),
        location,
        city: row['City'] || '',
        latitude: geocache[uuid].latitude,
        longitude: geocache[uuid].longitude,
        url,
        approved: true,
        source: 'blop'
      });
    }
    
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(futureEvents, null, 2));
    await fs.writeFile(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));

    console.log(`✅ Processed BLOP events saved: ${futureEvents.length}`);

    await uploadToS3(OUTPUT_PATH, OUTPUT_S3_KEY);

  } catch (err) {
    console.error('❌ Error processing BLOP events:', err);
  }
}

processBlopEvents();
