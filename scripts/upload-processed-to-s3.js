/**
 * upload-processed-to-s3.js
 *
 * Uploads all processed JSON files from data/processed/
 * to your configured S3 bucket.
 *
 * To run manually:
 *   node scripts/upload-processed-to-s3.js
 */

const fs = require('fs').promises;
const path = require('path');
const AWS = require('aws-sdk');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// === CONFIGURATION ===
const BUCKET_NAME = process.env.S3_BUCKET;  // ← pulls from your .env
const REGION = 'us-east-2'; // or whichever you set
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,  // you can load these from .env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: REGION
});

const s3 = new AWS.S3();

async function uploadFile(filePath, key) {
  const fileContent = await fs.readFile(filePath);

  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileContent,
    ContentType: 'application/json'
  };

  return s3.upload(params).promise();
}

async function uploadProcessedFiles() {
  try {
    const files = await fs.readdir(PROCESSED_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const localPath = path.join(PROCESSED_DIR, file);
      const s3Key = `processed/${file}`; // puts under processed/ folder in S3

      console.log(`📤 Uploading ${file} to s3://${BUCKET_NAME}/${s3Key}`);
      await uploadFile(localPath, s3Key);
      console.log(`✅ Uploaded ${file}`);
    }

    console.log('🎉 All processed files uploaded successfully.');
  } catch (err) {
    console.error('❌ Error uploading processed files:', err);
  }
}

uploadProcessedFiles();
