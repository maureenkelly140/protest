/**
 * process-mobilize.js
 *
 * This script reads raw Mobilize event files (data/raw/mobilize-page*.json),
 * applies filtering and processing logic, and outputs the processed events to:
 *   1. Local file: data/processed/mobilize-events.json
 *   2. S3 bucket: [your configured bucket]/processed/mobilize-events.json
 *
 * To run manually:
 *   node scripts/process-mobilize.js
 *
 * Typical use case:
 * This script is part of the full data pipeline. After fetching the latest Mobilize
 * data (via fetch-mobilize.js), run this script to generate clean, UI-ready data
 * and publish it to S3 for the website to consume.
 */


require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { processMobilizeEvents } = require('../server/utils/processMobilizeEvents');
const AWS = require('aws-sdk');

const RAW_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_LOCAL = path.join(__dirname, '../data/processed/mobilize-events.json');
const OUTPUT_S3_KEY = 'processed/mobilize-events.json';
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

async function run() {
  try {
    const files = await fs.readdir(RAW_DIR);
    const chunkFiles = files.filter(f => f.startsWith('mobilize-page') && f.endsWith('.json'));

    let allEvents = [];
    for (const file of chunkFiles) {
      console.log(`📂 Reading ${file}`);
      const raw = await fs.readFile(path.join(RAW_DIR, file), 'utf-8');
      const events = JSON.parse(raw);
      allEvents.push(...events);
    }

    const processed = await processMobilizeEvents(allEvents, Date.now());
    const included = processed.filter(e => e.action === 'included');

    await fs.writeFile(OUTPUT_LOCAL, JSON.stringify(included, null, 2), 'utf-8');
    console.log(`✅ Saved ${included.length} processed Mobilize events locally at ${OUTPUT_LOCAL}`);

    await uploadToS3(OUTPUT_LOCAL, OUTPUT_S3_KEY);

  } catch (err) {
    console.error('❌ Error processing Mobilize events:', err);
  }
}

run();
