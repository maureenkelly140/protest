// === SETUP ===
require('dotenv').config();

const https = require('https');
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

const { processMobilizeEvents } = require('./utils/processMobilizeEvents');
const { formatLocation } = require('./utils/format');

const Papa = require('papaparse');
const MANUAL_PROTESTS_PATH = path.join(__dirname, '../data/processed/manual-protests.json');
const GEOCACHE_PATH = path.join(__dirname, '../data/cache/blop-geocache.json');

const { geocodeAddress } = require('./utils/geocode');

// === CONFIG TOGGLE BLOCK ===
const CONFIG = {
  includeMobilize: true,
  includeManual: true,
  includeBlop: true,
  startDate: '', // null means "today"; or specify a string like '2025-01-01'
};

const startTimestamp = Math.floor(
  new Date(CONFIG.startDate || Date.now()).getTime() / 1000
);

const diagnostics = []; // for tracking display vs. filtered events

// === MIDDLEWARE ===
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// === HELPER ===
function shouldIncludeEvent(eventDateStr) {
  const eventDate = new Date(eventDateStr);
  const cutoffDate = new Date(CONFIG.startDate || Date.now());
  return eventDate >= cutoffDate;
}

// === ROUTES ===
app.get('/events', async (req, res) => {
  console.log('Start date filter:', CONFIG.startDate || 'today');
  console.log('Cutoff timestamp:', new Date(CONFIG.startDate || Date.now()).toISOString());
  console.log(`startTimestamp: ${startTimestamp} → ${new Date(startTimestamp * 1000).toISOString()}`);

  try {
    const now = Date.now();
    let combinedEvents = [];

    // --- Mobilize ---
    const MOBILIZE_S3_URL = 'https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/mobilize-events.json';
    
    if (CONFIG.includeMobilize) {
      try {
        const mobilizeData = await new Promise((resolve, reject) => {
          https.get(MOBILIZE_S3_URL, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });

        console.log(`✅ Loaded ${mobilizeData.length} Mobilize events from S3`);
        combinedEvents.push(...mobilizeData);
      } catch (err) {
        console.warn('⚠️ Could not load Mobilize events from S3:', err.message);
      }
    }

    // --- Manual ---
    if (CONFIG.includeManual) {
      try {
        const raw = await fs.readFile(MANUAL_PROTESTS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);

        const cutoff = new Date(CONFIG.startDate || Date.now());
        cutoff.setHours(0, 0, 0, 0);

        const filtered = parsed.filter(e => {
          const eventDate = new Date(e.date);
          eventDate.setHours(0, 0, 0, 0);
          if (isNaN(eventDate)) return false;
          return shouldIncludeEvent(e.date);
        });

        combinedEvents.push(...filtered);
      } catch (err) {
        console.warn('⚠️ Could not load manual protests:', err.message);
      }
    }

    // --- BLOP (from S3) ---
    if (CONFIG.includeBlop) {
      try {
        const response = await fetch('https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/blop-events.json');
        if (!response.ok) throw new Error('Failed to fetch blop-events.json from S3');
        const parsed = await response.json();

        const cutoff = new Date(CONFIG.startDate || Date.now());
        cutoff.setHours(0, 0, 0, 0);

        const filtered = parsed.filter(e => {
          const eventDate = new Date(e.date);
          eventDate.setHours(0, 0, 0, 0);
          if (isNaN(eventDate)) return false;
          return eventDate >= cutoff;
        });

        combinedEvents.push(...filtered);
      } catch (err) {
        console.warn('⚠️ Could not load blop-events.json from S3:', err.message);
      }
    }

    combinedEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(combinedEvents);
  } catch (error) {
    console.error('Error processing events:', error);
    res.status(500).json({ error: 'Something went wrong fetching or merging events' });
  }
});

// === Diagnostics Route ===
app.get('/mobilize-diagnostics', async (req, res) => {
  try {
      const files = await fs.readdir('./data/raw');
      const chunkFiles = files.filter(f => f.startsWith('all-mobilize-page') && f.endsWith('.json'));

      let allEvents = [];
      for (const file of chunkFiles) {
          console.log(`📂 Reading diagnostics chunk ${file}`);
          const raw = await fs.readFile(`./data/raw/${file}`, 'utf-8');
          const events = JSON.parse(raw);
          allEvents.push(...events);
      }

      const cutoffTime = new Date(CONFIG.startDate || Date.now()).getTime();
      const processedEvents = await processMobilizeEvents(allEvents, cutoffTime);

      console.log(`✅ Loaded ${processedEvents.length} events for diagnostics`);

      const counts = processedEvents.reduce((acc, e) => {
          acc[e.action] = (acc[e.action] || 0) + 1;
          return acc;
      }, {});

      res.json({
          total: processedEvents.length,
          counts,
          events: processedEvents,
      });

  } catch (err) {
      console.error('❌ Error loading diagnostics data:', err);
      res.status(500).json({ error: 'Failed to load diagnostics data' });
  }
});

// === START SERVER ===
app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
