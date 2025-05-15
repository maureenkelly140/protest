/**
 * upload-processed-to-s3.js
 *
 * Uploads all processed JSON files from data/processed/
 * to your configured S3 bucket — excluding manual-protests.json.
 */

const fs = require('fs').promises;
const path = require('path');
const AWS = require('aws-sdk');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// === CONFIGURATION ===
const BUCKET_NAME = process.env.S3_BUCKET;
const REGION = process.env.S3_REGION || 'us-west-1';
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: REGION
});

const s3 = new AWS.S3();

async function uploadFile(filePath, key) {
  const fileContent
