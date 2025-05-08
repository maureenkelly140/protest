/**
 * process-all.js
 *
 * This script runs all processing pipelines:
 * - Mobilize
 * - Blop
 *
 * Manual events are assumed to already exist as:
 *   data/processed/manual-protests.json
 *
 * To run manually:
 *   node scripts/process-all.js
 */

const { execSync } = require('child_process');

async function run() {
  try {
    console.log('🚀 Processing Mobilize events...');
    execSync('node scripts/process-mobilize.js', { stdio: 'inherit' });

    console.log('🚀 Processing Blop events...');
    execSync('node scripts/process-blop.js', { stdio: 'inherit' });

    console.log('✅ All event sources processed successfully.');
  } catch (err) {
    console.error('❌ Error running process-all:', err);
  }
}

run();
