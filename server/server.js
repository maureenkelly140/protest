// === SETUP ===
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;
// const basicAuth = require('express-basic-auth');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const MANUAL_PROTESTS_PATH = path.join(__dirname, '../data/processed/manual-protests.json');

const Papa = require('papaparse');
const CACHE_PATH = path.join(__dirname, 'blop-events.json');
const GEOCACHE_PATH = path.join(__dirname, 'blop-geocache.json');
const organizationIds = [42068, 42138, 41722]; // Tesla Takedown Sacramento, 50501 Houston, May Day Strong

// === Protect Admin Page ===
// app.use('/admin-review-events.html', basicAuth({
//   users: { 'admin': 'goodtrouble' },
//  challenge: true
// }));

// === Serve Static Frontend ===
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    console.log(`🔍 Geocoding: ${url}`);
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

// --- Load all events into the UI ---
app.get('/events', async (req, res) => {
  try {
    const now = Date.now();

    // --- Fetch Mobilize events ---
    const fetchPromises = organizationIds.map(id =>
      fetch(`https://api.mobilize.us/v1/organizations/${id}/events`).then(r => r.json())
    );

    const mobilizeResults = await Promise.all(fetchPromises);
    const mobilizeRawEvents = mobilizeResults.flatMap(r => r.data || []);

    const mobilizeFutureEvents = mobilizeRawEvents.filter(event =>
      event.timeslots?.some(timeslot => (timeslot.start_date * 1000) > now)
    );

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
          url: event.browser_url,
          source: 'mobilize'
        };
      })
    );

    console.log(`Mobilize events fetched and mapped: ${mobilizeMapped.length}`);

    // --- Load manually added protests ---
    const protestsJsonRaw = await fs.readFile(MANUAL_PROTESTS_PATH, 'utf-8');
    const manualProtests = JSON.parse(protestsJsonRaw);

    const manualFutureProtests = manualProtests.filter(event =>
      new Date(event.date).getTime() > now
    );

    console.log(`Manual protests loaded: ${manualFutureProtests.length}`);

    // --- Load BLOP events from cache ---
    let blopEvents = [];
    try {
      const blopRaw = await fs.readFile(path.join(__dirname, 'blop-events.json'), 'utf8');
      blopEvents = JSON.parse(blopRaw).filter(event =>
        new Date(event.date).getTime() > now
      );
      console.log(`BLOP events loaded from cache: ${blopEvents.length}`);
      console.log('Sample BLOP event:', blopEvents[0]);
    } catch (err) {
      console.warn('⚠️ Could not load blop-events.json:', err.message);
    }

    // --- Merge all sources ---
    const combinedEvents = [
      ...mobilizeMapped.filter(Boolean),
      ...manualFutureProtests,
      ...blopEvents
    ];

    combinedEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log(`Combined total events to send: ${combinedEvents.length}`);

    res.json(combinedEvents);
  } catch (error) {
    console.error('Error processing events:', error);
    res.status(500).json({ error: 'Something went wrong fetching or merging events' });
  }
});

app.get('/api/blop-events', async (req, res) => {
  try {
    const events = JSON.parse(await fs.readFile(path.join(__dirname, 'blop-events.json'), 'utf8'));
    res.json(events);
  } catch (err) {
    console.error('Failed to load blop-events.json:', err);
    res.status(500).json({ error: 'Could not load events' });
  }
});

// --- Add New Event ---
app.post('/add-event', async (req, res) => {
  try {
    const newEvent = req.body;
    const fileData = await fs.readFile(MANUAL_PROTESTS_PATH, 'utf-8');
    const existingEvents = JSON.parse(fileData);

    existingEvents.push(newEvent);

    await fs.writeFile(MANUAL_PROTESTS_PATH, JSON.stringify(existingEvents, null, 2));
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
    const events = JSON.parse(await fs.readFile(MANUAL_PROTESTS_PATH, 'utf8'))
    const pendingEvents = events.filter(event => event.approved === false);
    res.json(pendingEvents);
  } catch (err) {
    console.error('Error reading pending events:', err);
    res.status(500).json({ error: 'Failed to read pending events' });
  }
});

// --- Admin: Approve Event ---
app.post('/approve-event', async (req, res) => {
  const { id, title, location, date, latitude, longitude, approved } = req.body;

  try {
    const events = JSON.parse(await fs.readFile(MANUAL_PROTESTS_PATH, 'utf8'));
    const index = events.findIndex(event => event.id === id);
    
    if (index === -1) {
      return res.status(404).json({ message: 'Event not found' });
    }

    events[index] = {
      ...events[index], // keep all existing fields
      title,
      location,
      date,
      latitude,
      longitude,
      approved
    };

    console.log('Writing manual protests...');
    await fs.writeFile(MANUAL_PROTESTS_PATH, JSON.stringify(events, null, 2));
    console.log('Done writing manual protests');
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
    const events = JSON.parse(await fs.readFile(MANUAL_PROTESTS_PATH, 'utf8'));
    const updatedEvents = events.filter(event => event.id !== id);

    await fs.writeFile(MANUAL_PROTESTS_PATH, JSON.stringify(updatedEvents, null, 2));
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
