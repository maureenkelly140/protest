/**
 * fetch-mobilize.js
 *
 * Fetches all available Mobilize events via API, saves paginated raw files
 * to both local /data/raw and S3 under raw/mobilize-pageX.json.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const AWS = require('aws-sdk');

const OUTPUT_DIR = './data/raw';
const BASE_URL = 'https://api.mobilize.us/v1/events?timeslot_start=gte_now';
const PER_PAGE = 200;

const BUCKET_NAME = process.env.S3_BUCKET;
const REGION = 'us-west-1';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: REGION,
});

const s3 = new AWS.S3();

async function uploadToS3(filePath, s3Key) {
  const fileContent = await fs.readFile(filePath);

  const params = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: 'application/json',
  };

  return s3.upload(params).promise();
}

async function cleanupOldChunks() {
  const files = await fs.readdir(OUTPUT_DIR);
  const oldChunks = files.filter(f => f.startsWith('mobilize-page') && f.endsWith('.json'));

  for (const file of oldChunks) {
    await fs.unlink(path.join(OUTPUT_DIR, file));
    console.log(`🗑️ Deleted local old chunk: ${file}`);
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
        const localFilename = `mobilize-page${page}.json`;
        const localPath = path.join(OUTPUT_DIR, localFilename);
        const s3Key = `raw/${localFilename}`;

        await fs.writeFile(localPath, JSON.stringify(json.data, null, 2), 'utf-8');
        console.log(`💾 Saved locally: ${localFilename}`);

        await uploadToS3(localPath, s3Key);
        console.log(`☁️ Uploaded to S3: ${s3Key}`);
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
