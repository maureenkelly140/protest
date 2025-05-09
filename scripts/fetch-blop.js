/**
 * fetch-blop.js
 *
 * Downloads the latest Blop CSV and uploads it to S3.
 */

require('dotenv').config();
const fs = require('fs').promises;
const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const path = require('path');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT4ejObVvtY9C-dAH5wmUFDOW3K6uRGT6SCZPmr2ZPD1Sh-wb9OEeLj-lvqlUD-MFoDFof4cLGamxlz/pub?gid=0&single=true&output=csv';
const LOCAL_PATH = path.join(__dirname, '../data/raw/blop-latest.csv');
const S3_KEY = 'raw/blop-latest.csv';

const BUCKET_NAME = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'us-west-1';

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
    ContentType: 'text/csv',
  };
  await s3.upload(params).promise();
  console.log(`✅ Uploaded ${s3Key} to S3 bucket ${BUCKET_NAME}`);
}

async function fetchBlopCsv() {
  try {
    console.log('🌐 Fetching latest Blop CSV...');
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.statusText}`);

    const csv = await res.text();
    await fs.writeFile(LOCAL_PATH, csv, 'utf-8');
    console.log(`💾 Saved Blop CSV locally: ${LOCAL_PATH}`);

    await uploadToS3(LOCAL_PATH, S3_KEY);

  } catch (err) {
    console.error('❌ Error fetching Blop CSV:', err);
  }
}

fetchBlopCsv();
