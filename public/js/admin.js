// === CONFIGURATION ===
const API_BASE_URL = 'http://localhost:3001'; // 🔥 Update this when you deploy

// === MAIN FUNCTIONS ===

// Load all pending events into the table
async function loadPendingEvents() {
  try {
    const res = await fetch(`${API_BASE_URL}/pending-events`);
    const events = await res.json();

    const tbody = document.querySelector('#pending-events-table tbody');
    tbody.innerHTML = '';

    events.forEach(event => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td><input class="form-field" type="text" value="${event.title || ''}"></td>
        <td><input class="form-field" type="text" value="${event.location || ''}"></td>
        <td><input class="form-field" type="text" value="${formatLocalDate(event.date)}"></td>
        <td class="align-center"><a href="${event.url}" target="_blank" class="btn admin-btn" style="text-decoration: none;"><span class="material-symbols-outlined" >link</span></a></td>
        <td class="align-center"><button class="btn admin-btn view-map-btn" data-lat="${event.latitude}" data-lon="${event.longitude}">
              <span class="material-symbols-outlined">location_on</span>
            </button></td>
        <td class="align-center"><button class="btn admin-btn approve-btn">
              <span class="material-symbols-outlined">check_circle</span>
            </button></td>
        <td class="align-center"><button class="btn admin-btn delete-btn">
              <span class="material-symbols-outlined">delete</span>
            </button></td>
      `;

      // Attach event handlers
      tr.querySelector('.approve-btn').addEventListener('click', () => approveEvent(event, tr));
      tr.querySelector('.delete-btn').addEventListener('click', () => deleteEvent(event, tr));

      tbody.appendChild(tr);
    });

  } catch (error) {
    console.error('Error loading pending events:', error);
    alert('Failed to load pending events. Check console.');
  }
}

// Approve an event (with optional edits)
async function approveEvent(event, row) {
  const updatedTitle = row.querySelector('td:nth-child(1) input').value.trim();
  const updatedLocation = row.querySelector('td:nth-child(2) input').value.trim();
  const updatedDateRaw = row.querySelector('td:nth-child(3) input').value.trim();
  const updatedDate = new Date(updatedDateRaw);

  if (!updatedTitle || !updatedLocation || isNaN(updatedDate.getTime())) {
    alert('Please fill out all fields correctly before approving.');
    return;
  }

  try {
    // === Geocode the updated location ===
    const geoResult = await geocodeAddress(updatedLocation);

    if (!geoResult) {
      alert('Could not geocode the updated address. Please double-check it.');
      return;
    }

    const { latitude, longitude } = geoResult;

    const res = await fetch(`${API_BASE_URL}/approve-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: event.id,
        title: updatedTitle,
        location: updatedLocation,
        date: updatedDate.toISOString(),
        latitude,
        longitude,
        approved: true
      })
    });

    if (res.ok) {
      row.remove();
    } else {
      const result = await res.json();
      alert('Error approving event: ' + result.message);
    }
  } catch (error) {
    console.error('Error approving event:', error);
    alert('Failed to approve event.');
  }
}


// Delete an event
async function deleteEvent(event, row) {
  if (!confirm('Are you sure you want to delete this event?')) return;

  try {
    const res = await fetch(`${API_BASE_URL}/delete-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id })
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
  return date.toLocaleString('en-US');
}

// Helper: Geocode an address using Nominatim
async function geocodeAddress(address) {
  const encodedAddress = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ProtestFinderAdmin/1.0' }
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

// === New View Map Handler ===
document.addEventListener('click', async (e) => {
  const button = e.target.closest('.view-map-btn');
  if (button) {
    const row = button.closest('tr');
    const locationInput = row.querySelector('td:nth-child(2) input');
    const updatedLocation = locationInput.value.trim();

    if (!updatedLocation) {
      alert('Location field is empty.');
      return;
    }

    try {
      const geoResult = await geocodeAddress(updatedLocation);

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


// === INITIALIZATION ===
loadPendingEvents();
