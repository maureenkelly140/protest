/**
 * process-all.js
 *
 * This script runs the **full data pipeline**:
 * 1. Fetch latest raw data:
 *    - Mobilize (via fetch-mobilize.js)
 *    - Blop (via update-blop-all.sh)
 *
 * 2. Process and upload events:
 *    - Mobilize (via process-mobilize.js → local + S3)
 *    - Blop (via process-blop.js → local + S3)
 *
 * Manual events are **not processed locally**.
 * They are now managed entirely via the server UI and stored directly in S3:
 *   processed/manual-protests.json
 *
 * To run manually:
 *   node scripts/process-all.js
 */

const { execSync } = require('child_process');

async function run() {
  try {
    console.log('🚀 Fetching Mobilize raw data...');
    execSync('node scripts/fetch-mobilize.js', { stdio: 'inherit' });

    console.log('🚀 Processing Mobilize events...');
    execSync('node scripts/process-mobilize.js', { stdio: 'inherit' });

    console.log('🚀 Updating Blop raw data...');
    execSync('bash scripts/update-blop-all.sh', { stdio: 'inherit' });

    console.log('🧭 Generating event-locations.json...');
    execSync('node scripts/generate-event-locations.js', { stdio: 'inherit' });

    console.log('✅ All event sources fetched, processed, and uploaded successfully.');
  } catch (err) {
    console.error('❌ Error running process-all:', err);
  }
}

run();

