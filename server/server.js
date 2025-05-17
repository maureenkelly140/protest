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
const GEOCACHE_PATH = path.join(__dirname, '../data/cache/blop-geocache.json');

const { geocodeAddress } = require('./utils/geocode');

const OVERRIDE_KEY = 'data/overrides/event-overrides.json';
const SUPPRESSION_KEY = 'data/overrides/suppressed-events.json';


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
        const manualData = await loadJSONFromS3('processed/manual-protests.json');
    
        const filtered = manualData.filter(e => {
          const eventDate = new Date(e.date);
          eventDate.setHours(0, 0, 0, 0);
          if (isNaN(eventDate)) return false;
          return shouldIncludeEvent(e.date);
        });
    
        console.log(`✅ Loaded ${filtered.length} manual events from S3`);
        combinedEvents.push(...filtered);
      } catch (err) {
        console.warn('⚠️ Could not load manual protests from S3:', err.message);
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

// === Pending Events Route (for approving manual events) ===
app.get('/pending-events', async (req, res) => {
  try {
    const manualEvents = await loadJSONFromS3('processed/manual-protests.json')
    const pending = manualEvents.filter(ev => ev.approved === false);

    res.json(pending);
  } catch (err) {
    console.error('❌ Failed to load pending events:', err);
    res.status(500).json({ error: 'Failed to load pending events' });
  }
});


// === Diagnostics Route ===
app.get('/mobilize-diagnostics', async (req, res) => {
  try {
      const files = await fs.readdir('./data/raw');
      const chunkFiles = files.filter(f => f.startsWith('mobilize-page') && f.endsWith('.json'));

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

const { loadJSONFromS3, saveJSONToS3 } = require('./utils/s3');

// === Add Event Form ===
app.post('/add-event', async (req, res) => {
  try {
    const manualEvents = await loadJSONFromS3('processed/manual-protests.json');

    const { title, date, location, city, latitude, longitude, url } = req.body;

    const newEvent = {
      id: Date.now().toString(),
      title,
      date,
      location,
      city,
      latitude,
      longitude,
      url,
      visible: true,
      approved: false,
      addedAt: new Date().toISOString(),
      addedBy: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      source: 'manual'
    };

    manualEvents.push(newEvent);
    await saveJSONToS3('processed/manual-protests.json', manualEvents);

    res.json({ message: 'Event saved!' });
  } catch (err) {
    console.error('❌ Failed to save event:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

// === Save Event Route ===
app.post('/save-event', async (req, res) => {
  const {
    id,
    title,
    location,
    date,
    latitude,
    longitude,
    approved
  } = req.body;

  if (!id || !title || !location || !date) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const manualEvents = await loadJSONFromS3('processed/manual-protests.json');

    const index = manualEvents.findIndex(ev => ev.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Event not found' });
    }

    manualEvents[index] = {
      ...manualEvents[index],
      title,
      location,
      date,
      latitude,
      longitude,
      approved: !!approved
    };

    await saveJSONToS3('processed/manual-protests.json', manualEvents);
    res.json({ message: 'Event saved.' });

  } catch (err) {
    console.error('❌ Failed to save event:', err);
    res.status(500).json({ message: 'Failed to save event' });
  }
});

// === Geocoding Route (Mapbox) ===
app.post('/geocode', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    const result = await geocodeAddress(address);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'No geocoding result' });
    }
  } catch (err) {
    console.error('❌ Geocoding error:', err.message);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// === Delete Event Route ===
app.post('/delete-event', async (req, res) => {
  try {
    const manualEvents = await loadJSONFromS3('processed/manual-protests.json');
    const { id } = req.body;

    const originalLength = manualEvents.length;
    const updatedEvents = manualEvents.filter(ev => ev.id !== id);

    if (updatedEvents.length === originalLength) {
      return res.status(404).json({ message: 'Event not found' });
    }

    await saveJSONToS3('processed/manual-protests.json', updatedEvents);
    res.json({ message: 'Event deleted!' });
  } catch (err) {
    console.error('❌ Failed to delete event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

app.post('/override-event', async (req, res) => {
  try {
    const { sourceId, updates } = req.body;
    if (!sourceId || !updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid sourceId/updates' });
    }

    const overrides = await loadJSONFromS3(OVERRIDE_KEY);
    overrides[sourceId] = {
      ...(overrides[sourceId] || {}),
      ...updates
    };

    await saveJSONToS3(OVERRIDE_KEY, overrides);
    res.json({ message: 'Override saved' });
  } catch (err) {
    console.error('❌ Failed to save override:', err);
    res.status(500).json({ error: 'Failed to save override' });
  }
});

app.post('/suppress-event', async (req, res) => {
  try {
    const { sourceId } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'Missing sourceId' });

    let suppressed = await loadJSONFromS3(SUPPRESSION_KEY);
    if (!Array.isArray(suppressed)) suppressed = [];

    if (!suppressed.includes(sourceId)) {
      suppressed.push(sourceId);
      await saveJSONToS3(SUPPRESSION_KEY, suppressed);
    }

    res.json({ message: 'Event suppressed' });
  } catch (err) {
    console.error('❌ Failed to suppress event:', err);
    res.status(500).json({ error: 'Failed to suppress event' });
  }
});

// === START SERVER ===
app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
