// === SETUP ===
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;
// const basicAuth = require('express-basic-auth');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// === Protect Admin Page ===
// app.use('/admin-review-events.html', basicAuth({
//   users: { 'admin': 'goodtrouble' },
//  challenge: true
// }));

// === Serve Static Frontend ===
app.use(express.static(path.join(__dirname, '..', 'public')));

// === Load patches and other dynamic setup ===
let patches = [];

// === INITIALIZATION ===
// Load patches at startup
(async () => {
  try {
    const patchesData = await fs.readFile('patches.json', 'utf8');
    patches = JSON.parse(patchesData);
    console.log(`Loaded ${patches.length} patches.`);
  } catch (err) {
    console.error('Error loading patches.json:', err);
  }
})();

// === MIDDLEWARE ===
app.use(express.json());

// Allow your frontend to fetch data easily
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// === HELPERS ===
// Geocode an address using Nominatim
async function geocodeAddress(address) {
  const encodedAddress = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ProtestFinderApp/1.0' } // Nominatim asks for a real User-Agent
    });
    const data = await res.json();
    if (data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon)
      };
    } else {
      console.warn('No geocoding result for address:', address);
      return null;
    }
  } catch (err) {
    console.error('Geocoding failed for address:', address, err);
    return null;
  }
}

// === ROUTES ===

// --- Fetch Mobilize Events ---
const organizationIds = [42068, 42138, 41722]; // Tesla Takedown Sacramento, 50501 Houston, May Day Strong

app.get('/events', async (req, res) => {
  try {
    const now = Date.now();

    // Load patches inside the route
    let patches = [];
    try {
      const patchesData = await fs.readFile('patches.json', 'utf8');
      patches = JSON.parse(patchesData);
      console.log(`Loaded ${patches.length} patches.`);
    } catch (err) {
      console.error('Error loading patches.json:', err);
    }

    // --- Fetch Mobilize events ---
    const fetchPromises = organizationIds.map(id =>
      fetch(`https://api.mobilize.us/v1/organizations/${id}/events`).then(r => r.json())
    );

    const mobilizeResults = await Promise.all(fetchPromises);
    const mobilizeRawEvents = mobilizeResults.flatMap(r => r.data || []);

    const mobilizeFutureEvents = mobilizeRawEvents.filter(event => {
      return event.timeslots?.some(timeslot => (timeslot.start_date * 1000) > now);
    });

    const mobilizeMapped = await Promise.all(
      mobilizeFutureEvents.map(async event => {
        const futureTimes = event.timeslots.filter(t => (t.start_date * 1000) > now);
        const nextTimeslot = futureTimes.length > 0
          ? futureTimes.sort((a, b) => a.start_date - b.start_date)[0]
          : event.timeslots.sort((a, b) => b.start_date - a.start_date)[0];

        let latitude = event.location?.latitude;
        let longitude = event.location?.longitude;

        if (!latitude || !longitude) {
          const address = event.location?.venue || (event.location?.address_lines?.join(', '));
          if (address) {
            const geo = await geocodeAddress(address);
            if (geo) {
              latitude = geo.latitude;
              longitude = geo.longitude;
            }
          } else {
            console.warn('Skipping event with no usable location:', event.title);
            return null;
          }
        }

        // Validate latitude/longitude bounds
        if (
          latitude < 24 || latitude > 50 ||   
          longitude < -125 || longitude > -66
        ) {
          console.warn(`Skipping event "${event.title}" with suspicious lat/lon: ${latitude}, ${longitude}`);
          return null;
        }

        return {
          title: event.title,
          date: new Date(nextTimeslot.start_date * 1000).toISOString(),
          location: event.location?.venue || (event.location?.address_lines?.join(', ')) || 'Unknown location',
          latitude,
          longitude,
          url: event.browser_url
        };
      })
    );

    // Apply patches
    mobilizeMapped.forEach(event => {
      patches.forEach(patch => {
        if (event.title.includes(patch.match)) {
          event.latitude = patch.latitude;
          event.longitude = patch.longitude;
          console.log(`Patched event: ${event.title}`);
        }
      });
    });

    console.log(`Mobilize events fetched and mapped: ${mobilizeMapped.length}`);

    // --- Load Manual protests.json ---
    const protestsJsonRaw = await fs.readFile('protests.json', 'utf-8');
    const manualEvents = JSON.parse(protestsJsonRaw);

    const manualFutureEvents = manualEvents.filter(event => {
      const eventTime = new Date(event.date).getTime();
      return eventTime > now;
    });

    console.log(`Manual protests loaded: ${manualFutureEvents.length}`);

    // --- Merge both ---
    const combinedEvents = [...mobilizeMapped, ...manualFutureEvents];
    combinedEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log(`Combined total events to send: ${combinedEvents.length}`);

    res.json(combinedEvents);
  } catch (error) {
    console.error('Error processing events:', error);
    res.status(500).json({ error: 'Something went wrong fetching or merging events' });
  }
});

// --- Fetch BLOP Events ---
// server/blop-sync.js
const Papa = require('papaparse');

const BLOB_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSpxUvu0PvCQrcCqIMJEEIm0jKh-wW84AlG-k2iz5Jz5HFbCKIm5Vp2JrKZ04kUN6iH9JvepvJLtP-y/pub?gid=141296177&single=true&output=csv';
const CACHE_PATH = path.join(__dirname, 'blop-events.json');
const GEOCACHE_PATH = path.join(__dirname, 'blop-geocache.json');

// Helper: Geocode an address using Nominatim
async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ProtestFinderApp/1.0' } });
    const data = await res.json();
    if (data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon)
      };
    }
  } catch (err) {
    console.warn('Geocoding failed:', address, err);
  }
  return null;
}

async function syncBlopEvents() {
  try {
    const res = await fetch(BLOB_CSV_URL);
    const csvText = await res.text();
    const parsed = Papa.parse(csvText, { header: true });
    const rows = parsed.data;

    let geocache = {};
    try {
      geocache = JSON.parse(await fs.readFile(GEOCACHE_PATH, 'utf8'));
    } catch (e) {
      console.log('No geocache found, starting fresh.');
    }

    const now = Date.now();
    const futureEvents = [];

    for (const row of rows) {
      const uuid = row['UUID'] || row['Canonical UUID'];
      if (!uuid || !row['Date'] || !row['Time'] || !row['Title']) continue;

      const dateStr = `${row['Date']} ${row['Time']}`;
      const date = new Date(dateStr);
      if (isNaN(date.getTime()) || date.getTime() < now) continue;

      const location = [row['Address'], row['City'], row['State']].filter(Boolean).join(', ');
      if (!location) continue;

      if (!geocache[uuid]) {
        const geo = await geocodeAddress(location);
        if (geo) {
          geocache[uuid] = geo;
        } else {
          console.warn(`Skipping event due to failed geocode: ${row['Title']}`);
          continue;
        }
      }

      futureEvents.push({
        title: row['Title'],
        date: date.toISOString(),
        location,
        latitude: geocache[uuid].latitude,
        longitude: geocache[uuid].longitude,
        url: row['Links']?.split(',')[0] || '',
        approved: true,
        source: 'blop'
      });
    }

    await fs.writeFile(CACHE_PATH, JSON.stringify(futureEvents, null, 2));
    await fs.writeFile(GEOCACHE_PATH, JSON.stringify(geocache, null, 2));

    console.log(`✅ BLOP events synced: ${futureEvents.length}`);
  } catch (err) {
    console.error('❌ Error syncing BLOP events:', err);
  }
}

syncBlopEvents();


// --- Add New Event ---
app.post('/add-event', async (req, res) => {
  try {
    const newEvent = req.body;
    const fileData = await fs.readFile('protests.json', 'utf8');
    const existingEvents = JSON.parse(fileData);

    existingEvents.push(newEvent);

    await fs.writeFile('protests.json', JSON.stringify(existingEvents, null, 2));
    console.log('Saved new event:', newEvent.title);

    res.status(200).json({ message: 'Event saved!' });
  } catch (err) {
    console.error('Error saving new event:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

// --- Admin: Pending Events ---
app.get('/pending-events', async (req, res) => {
  try {
    const events = JSON.parse(await fs.readFile('protests.json', 'utf8'));
    const pendingEvents = events.filter(event => event.approved === false);
    res.json(pendingEvents);
  } catch (err) {
    console.error('Error reading pending events:', err);
    res.status(500).json({ error: 'Failed to read pending events' });
  }
});

// --- Admin: Approve Event ---
app.post('/approve-event', async (req, res) => {
  const { id, title, location, date } = req.body;

  try {
    const events = JSON.parse(await fs.readFile('protests.json', 'utf8'));
    const index = events.findIndex(event => event.id === id);
    
    if (index === -1) {
      return res.status(404).json({ message: 'Event not found' });
    }

    events[index].approved = true;
    events[index].title = title;
    events[index].location = location;
    events[index].date = date;

    await fs.writeFile('protests.json', JSON.stringify(events, null, 2));
    res.json({ message: 'Event approved.' });
  } catch (err) {
    console.error('Error approving event:', err);
    res.status(500).json({ error: 'Failed to approve event' });
  }
});

// --- Admin: Delete Event ---
app.post('/delete-event', async (req, res) => {
  const { id } = req.body;

  try {
    const events = JSON.parse(await fs.readFile('protests.json', 'utf8'));
    const updatedEvents = events.filter(event => event.id !== id);

    await fs.writeFile('protests.json', JSON.stringify(updatedEvents, null, 2));
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
