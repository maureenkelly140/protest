// === CONFIGURATION ===
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://protest-finder.onrender.com';

// ⚠️ This route declaration is invalid in frontend code — belongs in server.js
// Leaving in place temporarily for future admin UI refactor
/*
app.post('/geocode', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    const geo = await geocodeAddress(address);
    if (!geo) return res.status(404).json({ error: 'Address not found' });
    res.json(geo);
  } catch (err) {
    console.error('Geocoding error:', err.message);
    res.status(500).json({ error: 'Failed to geocode address' });
  }
});
*/

// === HELPER FUNCTIONS ===

function getReadableLocation(loc) {
  if (typeof loc === 'string') return loc;
  if (typeof loc === 'object' && loc !== null) {
    const parts = [
      loc.venue,
      ...(loc.address_lines || []),
      loc.locality,
      loc.region
    ];
    return parts.filter(Boolean).join(', ');
  }
  return 'Unknown location';
}

// === MAIN FUNCTIONS ===

// Create admin table
function renderAdminTable({ tableId, events, options = {} }) {
  const { filterUnapproved = false } = options;

  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';

  for (const ev of events) {
    const location =
      typeof ev.location === 'string'
        ? ev.location
        : (ev.location?.formatted_address || ev.location?.address || '');
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="admin-col-id">
        <div class="id">${ev.id}</div>
      </td>
      <td class="admin-col-title">
        <input class="form-field title-input" type="text" value="${ev.title || ''}">
      </td>
      <td class="admin-col-map">
        <div class="field-plus-icon">
          <input class="form-field location-input" type="text" value="${getReadableLocation(ev.location)}">
          <button class="btn admin-btn view-map-btn" data-id="${ev.id}" data-source="${ev.source || 'manual'}">
            <span class="material-symbols-outlined">location_on</span>
          </button>
        </div>
      </td>
      <td class="admin-col-url">
        ${ev.url ? `
          <a href="${ev.url}" target="_blank" class="btn admin-btn" title="Open link">
            <span class="material-symbols-outlined">link</span>
          </a>` : ''}
      </td>
      <td class="admin-col-source">
        ${ev.source || 'manual'}${ev.source === 'manual' && ev.addedBy ? ` (${ev.addedBy})` : ''}
      </td>
      <td class="admin-col-needs-review">
        ${ev.source === 'manual' && !ev.approved ? 'Needs review' : ''}
      </td>
      <td class="align-center admin-col-save">
        <button class="btn admin-btn save-btn">
          <span class="material-symbols-outlined">check</span>
        </button>
      </td>
      <td class="align-center admin-col-delete">
        <button class="btn admin-btn delete-btn">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </td>
    `;

    tbody.appendChild(tr);

    tr.querySelector('.save-btn').addEventListener('click', () => saveEvent(ev, tr));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEvent(ev, tr));

  }
}

// Save event (includes changing status of manual events to "approved")
async function saveEvent(event, row) {
  const updatedTitle = row.querySelector('.title-input').value.trim();
  const updatedLocation = row.querySelector('.location-input').value.trim();
  const updatedDateRaw = row.querySelector('.date-input')?.value.trim();
  const updatedDate = new Date(updatedDateRaw);

  if (!updatedTitle || !updatedLocation || isNaN(updatedDate.getTime())) {
    alert('Please fill out all fields correctly before saving.');
    return;
  }

  try {
    const geoRes = await fetch('/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: updatedLocation })
    });

    const geoResult = geoRes.ok ? await geoRes.json() : null;
    const { latitude, longitude } = geoResult || {};

    const isManual = event.source === 'manual';
    const wasUnapproved = !event.approved;
    const nowApproved = isManual && wasUnapproved;

    const payload = {
      id: event.id,
      title: updatedTitle,
      location: updatedLocation,
      date: updatedDate.toISOString(),
      latitude,
      longitude,
      approved: nowApproved ? true : event.approved
    };

    const endpoint = isManual ? '/save-event' : '/override-event';
    const body = isManual
      ? payload
      : {
          sourceId: event.id,
          updates: {
            title: updatedTitle,
            location: updatedLocation,
            date: updatedDate.toISOString(),
            latitude,
            longitude
          }
        };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const result = await res.json();
      alert('Error saving event: ' + result.message);
    } else {
      alert(nowApproved ? 'Event approved and saved!' : 'Event saved.');
      row.classList.remove('pending-row');
    }
  } catch (error) {
    console.error('Error saving event:', error);
    alert('Failed to save event.');
  }
}

// Delete an event
async function deleteEvent(event, row) {
  if (!confirm('Are you sure you want to delete this event?')) return;

  try {
    const isManual = event.source === 'manual';
    const endpoint = isManual ? '/delete-event' : '/suppress-event';
    const body = isManual
      ? { id: event.id }
      : { sourceId: event.id };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      row.remove();
    } else {
      const result = await res.json();
      alert('Error deleting event: ' + result.message);
    }
  } catch (error) {
    console.error('Error deleting event:', error);
    alert('Failed to delete event.');
  }
}

// Open a map preview in a new window
function openMapPopup(lat, lon, label = '') {
  const mapWindow = window.open('', 'mapWindow', 'width=400,height=300');
  mapWindow.document.write(`
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <div id="map" style="width: 100%; height: 100%;"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
    <script>
      const map = L.map('map').setView([${lat}, ${lon}], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      L.marker([${lat}, ${lon}]).addTo(map).bindPopup('${label.replace(/'/g, "\\'")}').openPopup();
    <\/script>
  `);
}

// Helper: format ISO string to local datetime string
function formatLocalDate(isoDateString) {
  const date = new Date(isoDateString);
  return date.toLocaleString('en-US', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

// === New View Map Handler ===
document.addEventListener('click', async (e) => {
  const button = e.target.closest('.view-map-btn');
  if (button) {
    const row = button.closest('tr');
    const locationInput = row.querySelector('.location-input');
    const updatedLocation = locationInput.value.trim();
    console.log('🧭 Map button clicked. Using updated location:', updatedLocation);


    if (!updatedLocation) {
      alert('Location field is empty.');
      return;
    }

    try {

      // ⚠️ This uses geocodeAddress() directly — will fail unless we rewire to hit backend /geocode
      // Leave as-is for now; revisit when admin flow is re-enabled
      const geoRes = await fetch(`${API_BASE_URL}/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: updatedLocation })
      });
      const geoResult = geoRes.ok ? await geoRes.json() : null;

      if (!geoResult) {
        alert('Could not geocode the updated address. Please check the location.');
        return;
      }

      const { latitude, longitude } = geoResult;

      openMapPopup(latitude, longitude, updatedLocation);

    } catch (error) {
      console.error('Error geocoding location:', error);
      alert('Error trying to show map for updated address.');
    }
  }
});
