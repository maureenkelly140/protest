// utils/s3.js
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION,
});

const BUCKET = process.env.S3_BUCKET;
console.log("🚀 S3 bucket in use:", BUCKET); // mk - temp

async function loadJSONFromS3(key) {
  const params = { Bucket: BUCKET, Key: key };
  try {
    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString());
  } catch (err) {
    console.error(`❌ Failed to load ${key} from S3:`, err);
    return []; // safe fallback
  }
}

async function saveJSONToS3(key, data) {

  // mk - temp logging
  console.log(`📝 Saving to S3 key: ${key}`);
  console.log("📤 Using bucket:", BUCKET);
  if (!BUCKET) {
    console.error('❌ BUCKET is undefined — check .env or dotenv setup');
  }
    
  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  };

  try {
    await s3.putObject(params).promise();
    console.log(`✅ Saved ${key} to S3`);
  } catch (err) {
    console.error(`❌ Failed to save ${key} to S3:`, err);
  }
}

module.exports = {
  loadJSONFromS3,
  saveJSONToS3
};
