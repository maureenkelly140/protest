// === CONFIGURATION ===
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://protest-finder.onrender.com';

// === GLOBAL STATE ===
let fetchedEvents = [];
let eventMarkers = new Map();
let fullEventMap = new Map();
let currentDateFilter = 'all';
let searchKeyword = '';
let suppressEventListRefresh = false;

const sourceFetchCache = new Map();

// === MAP SETUP ===
const map = L.map('map', { zoomControl: false, maxZoom: 18 }).setView([39.8283, -98.5795], 4);
const markerClusterGroup = L.markerClusterGroup();
map.addLayer(markerClusterGroup);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=MEOZ1SILbWpzsJ65uy1u', {
  tileSize: 512,
  zoomOffset: -1,
  attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
  crossOrigin: true
}).addTo(map);


if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => map.setView([coords.latitude, coords.longitude], 10),
    err => console.warn('Geolocation not available:', err.message)
  );
}

// === UTILITY FUNCTIONS ===
const normalIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [41, 41]
});

const highlightIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconSize: [35, 55], iconAnchor: [17, 55], popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [55, 55]
});

function formatEventUrl(url) {
  return url?.startsWith('http') ? url : `https://${url}`;
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return {
    friendlyDate: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    friendlyTime: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  };
}

function formatLocationClient(location) {
  if (typeof location === 'string') {
    return location;
  }

  if (typeof location === 'object' && location !== null) {
    return [
      location.venue,
      ...(location.address_lines || []),
      location.locality,
      location.region,
      location.postal_code,
      location.country
    ].filter(Boolean).join(', ');
  }

  return 'Unknown location';
}

// TODO: This just grabs the first part of the location string.
// Once geocoding is standardized on Mapbox, extract city from geocode result instead.
function extractCity(location) {
  if (typeof location !== 'string') return '';
  const parts = location.split(',');
  return parts.length > 0 ? parts[0].trim() : '';
}

function createEventMarker(ev) {
  if (!ev.latitude || !ev.longitude) {
    console.warn("Missing lat/lng for event:", ev);
    return;
  }

  const marker = L.marker([ev.latitude, ev.longitude], { icon: normalIcon });

  marker.on('click', async () => {
    const fullEvent = await getFullEventDetails(ev);
    if (!fullEvent) return;

    const { title, location, date, url } = fullEvent;
    marker.bindPopup(`
      <b>${title}</b><br>
      ${formatLocationClient(location)}<br>
      ${formatDateTime(date).friendlyDate} at ${formatDateTime(date).friendlyTime}<br>
      <a href="${formatEventUrl(url)}" target="_blank">View Details</a>
    `).openPopup();
  });

  markerClusterGroup.addLayer(marker);
  eventMarkers.set(ev.id, marker);
}

// === EVENT HANDLING ===
const LOCATIONS_URL = 'https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/event-locations.json';

function isListVisible() {
  return !isMobile() || document.getElementById('panel-list').offsetParent !== null;
}

// Fetch minimal event location data to populate the map
async function fetchEvents() {
  showSkeletonLoader();

  try {
    const res = await fetch(LOCATIONS_URL);
    const rawEvents = await res.json();

    fetchedEvents = rawEvents.filter(ev => {
      if (currentDateFilter === 'future') {
        const eventDate = new Date(ev.start_date * 1000);
        return eventDate >= new Date();
      }
      return true;
    });

    updateVisibleMapMarkers();
    if (isListVisible()) {
      updateVisibleListOnly();
    }
  } catch (err) {
    console.error('Error fetching event locations:', err);
    showErrorMsg();
  }
}

// Clear all markers and list entries before re-rendering
function clearMarkersAndList(preservePopup = false) {
  if (!preservePopup) map.closePopup();
  eventMarkers.forEach(marker => map.removeLayer(marker));
  eventMarkers.clear();
  markerClusterGroup.clearLayers();
  document.getElementById('events').innerHTML = '';
}

function showErrorMsg() {
  document.getElementById('events').innerHTML = `<div class="null-msg">Error loading events. Check console for details.</div>`;
}

function showSkeletonLoader(count = 5) {
  const container = document.getElementById('events');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'event skeleton';
    skeleton.innerHTML = `<div class="date-col"></div><div class="detail-col"></div><div class="btn-col"></div>`;
    container.appendChild(skeleton);
  }
}

// Load full event details from the appropriate source file
async function getFullEventDetails(ev) {
  const cached = fullEventMap.get(ev.id);
  if (cached) return cached;

  if (ev && ev.title && ev.date) {
    fullEventMap.set(ev.id, ev); // assume this is already full
    return ev;
  }

  if (!sourceFetchCache.has(ev.source)) {
    let detailUrl;
    switch (ev.source) {
      case 'mobilize':
        detailUrl = 'https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/mobilize-events.json'; break;
      case 'blop':
        detailUrl = 'https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/blop-events.json'; break;
      case 'manual':
        detailUrl = 'https://my-protest-finder-data.s3.us-west-1.amazonaws.com/processed/manual-protests.json'; break;
      default:
        return null;
    }

    // Start the fetch and store the Promise immediately
    const fetchPromise = (async () => {
      console.log(`📡 Fetching ${ev.source} events...`);
      const res = await fetch(detailUrl);
      const json = await res.json();
      return json;
    })();

    sourceFetchCache.set(ev.source, fetchPromise);
  }

  const all = await sourceFetchCache.get(ev.source); // Wait on the promise
  const match = all.find(e => e.id == ev.id);
  if (match) {
    match.baseEvent = ev;
    fullEventMap.set(ev.id, match);
  }

  return match || null;
}

// Filter events based on map bounds only.
// Leave date/search filtering to updateVisibleListOnly (with full data).
function filterVisibleEvents() {
  const bounds = map.getBounds();

  return fetchedEvents.filter(ev => {
    const lat = ev.lat ?? ev.latitude;
    const lng = ev.lng ?? ev.longitude;
    if (lat === undefined || lng === undefined) return false;
    return bounds.contains([lat, lng]);
  });
}

// Render only the map markers, based on minimal location data
async function updateVisibleMapMarkers() {
  markerClusterGroup.clearLayers();
  eventMarkers.clear();

  const visible = await filterVisibleEvents();

  const isFiltered = searchKeyword || currentDateFilter !== 'all';

  let filteredEvents = visible;

  if (isFiltered) {
    const detailedList = await Promise.all(visible.map(getFullEventDetails));
    filteredEvents = detailedList.filter(ev => {
      if (!ev) return false;

      // --- DATE FILTERING ---
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + 7);

      const dateObj = new Date(ev.date ?? ev.start_date * 1000);
      if (dateObj < now) return false;

      const matchesDate =
        currentDateFilter === 'all' ||
        (currentDateFilter === 'today' &&
          dateObj >= today && dateObj < new Date(today.getTime() + 86400000)) ||
        (currentDateFilter === 'week' &&
          dateObj >= today && dateObj <= weekEnd) ||
        (currentDateFilter === 'june14' &&
          dateObj.getUTCFullYear() === 2025 &&
          dateObj.getUTCMonth() === 5 &&
          dateObj.getUTCDate() === 14);

      if (!matchesDate) return false;

      // --- SEARCH FILTERING ---
      if (searchKeyword) {
        const title = ev.title?.toLowerCase() || '';
        const loc = formatLocationClient(ev.location)?.toLowerCase() || '';
        return title.includes(searchKeyword) || loc.includes(searchKeyword);
      }

      return true;
    });
  }

  filteredEvents.forEach(ev => {
    const lat = ev.lat ?? ev.latitude;
    const lng = ev.lng ?? ev.longitude;
    if (lat === undefined || lng === undefined) return;

    const marker = L.marker([lat, lng], { icon: normalIcon });

    marker.on('click', async () => {
      const fullEvent = await getFullEventDetails(ev);
      if (!fullEvent) return;

      const { title, location, date, url } = fullEvent;
      marker.bindPopup(`
        <b>${title}</b><br>
        ${formatLocationClient(location)}<br>
        ${formatDateTime(date).friendlyDate} at ${formatDateTime(date).friendlyTime}<br>
        <a href="${formatEventUrl(url)}" target="_blank">View Details</a>
      `).openPopup();
    });

    markerClusterGroup.addLayer(marker);
    eventMarkers.set(ev.id, marker);
  });
}

// Render the list view with full event details, lazily loaded
let isUpdatingList = false;

async function updateVisibleListOnly() {
  if (!isListVisible()) return;
  if (isUpdatingList) {
    console.log('⏳ Skipping: updateVisibleListOnly is already running');
    return;
  }

  isUpdatingList = true;
  console.time('💡 Fetching full event details');

  try {
    const visible = filterVisibleEvents();
    const container = document.getElementById('events');
    const counter = document.getElementById('event-counter');

    const detailedList = await Promise.all(visible.map(getFullEventDetails));
    
    const filtered = detailedList.filter(ev => {
      if (!ev) return false;
    
      // --- DATE FILTERING ---
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + 7);
    
      const dateObj = new Date(ev.date ?? ev.start_date * 1000);
      if (dateObj < now) return false;
    
      const matchesDate =
        currentDateFilter === 'all' ||
        (currentDateFilter === 'today' &&
          dateObj >= today && dateObj < new Date(today.getTime() + 86400000)) ||
        (currentDateFilter === 'week' &&
          dateObj >= today && dateObj <= weekEnd) ||
        (currentDateFilter === 'june14' &&
          dateObj.getUTCFullYear() === 2025 &&
          dateObj.getUTCMonth() === 5 &&
          dateObj.getUTCDate() === 14);
    
      if (!matchesDate) return false;
    
      // --- SEARCH FILTERING ---
      if (searchKeyword) {
        const title = ev.title?.toLowerCase() || '';
        const loc = formatLocationClient(ev.location)?.toLowerCase() || '';
        return title.includes(searchKeyword) || loc.includes(searchKeyword);
      }
    
      return true;
    });
    
    if (counter) {
      counter.innerHTML = filtered.length
        ? `${filtered.length} protest${filtered.length !== 1 ? 's' : ''} found`
        : 'No protests found';
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="null-msg">
          <p>No protests found in this area.</p>
          <button class="btn" id="reset-view-btn">Show All Protests</button>
        </div>`;
      document.getElementById('reset-view-btn').addEventListener('click', () => {
        map.flyTo([39.8283, -98.5795], 4);
        currentDateFilter = 'all';
        document.getElementById('selected-filter').textContent = 'All Dates';
        updateVisibleMapMarkers();
        updateVisibleListOnly();
      });
      return;
    }

    container.innerHTML = '';

    filtered.forEach(ev => {
      const { title, date, location, url } = ev;
      const { friendlyDate, friendlyTime } = formatDateTime(date);

      const el = document.createElement('a');
      el.className = 'event';
      el.href = formatEventUrl(url);
      el.target = isMobile() ? '_self' : '_blank';
      el.innerHTML = `
        <div class="date-col">
          <div class="date">${friendlyDate}</div>
          <div class="time">${friendlyTime}</div>
        </div>
        <div class="detail-col">
          <div class="event-title">${title}</div>
          <div class="event-description">${formatLocationClient(location)}</div>
        </div>
        <div class="btn-col">
          <span class="icon material-symbols-outlined open-url-btn tooltip" title="View Details">open_in_new</span>
        </div>`;

      el.addEventListener('click', async (e) => {
        if (!isMobile()) {
          e.preventDefault();

          const marker = eventMarkers.get(ev.baseEvent?.id ?? ev.id);
          if (!marker) {
            console.warn('No marker found for event ID:', ev.id);
            return;
          }

          suppressEventListRefresh = true;

          markerClusterGroup.zoomToShowLayer(marker, async () => {
            const fullEvent = await getFullEventDetails(ev);
            if (!fullEvent) return;

            const { title, location, date, url } = fullEvent;
            marker.bindPopup(`
              <b>${title}</b><br>
              ${formatLocationClient(location)}<br>
              ${formatDateTime(date).friendlyDate} at ${formatDateTime(date).friendlyTime}<br>
              <a href="${formatEventUrl(url)}" target="_blank">View Details</a>
            `).openPopup();

            setTimeout(() => updateVisibleListOnly(), 600);
          });
        }
      });

      el.querySelector('.open-url-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(formatEventUrl(url), '_blank');
      });

      container.appendChild(el);
    });

    $('.tooltip').tooltipster({
      animation: 'fade',
      theme: 'tooltipster-borderless',
      side: 'bottom',
      plugins: ['sideTip']
    });
  } finally {
    console.timeEnd('💡 Fetching full event details');
    isUpdatingList = false;
  }
}

// === UI HOOKS ===
document.getElementById('search-box').addEventListener('input', (e) => {
  searchKeyword = e.target.value.toLowerCase();
  updateVisibleMapMarkers();
  updateVisibleListOnly();
});

document.getElementById('date-filter').addEventListener('click', () => {
  document.getElementById('filter-options').classList.toggle('hidden');
});

document.querySelectorAll('.dropdown-option').forEach(option => {
  option.addEventListener('click', () => {
    currentDateFilter = option.dataset.filter;
    document.getElementById('selected-filter').textContent = option.textContent;
    document.getElementById('filter-options').classList.add('hidden');
    updateVisibleMapMarkers();
    updateVisibleListOnly();
  });
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('date-filter').contains(e.target)) {
    document.getElementById('filter-options').classList.add('hidden');
  }
});

map.on('moveend', () => {

  if (suppressEventListRefresh) {
    suppressEventListRefresh = false;
    return;
  }

  if (fetchedEvents && fetchedEvents.length > 0) {
    const isPopupOpen = document.getElementsByClassName('leaflet-popup');
    if (isPopupOpen.length > 0) {
      // popup is open, do nothing
    } else {
      updateVisibleMapMarkers();
      updateVisibleListOnly();
    }
  }
});

// Copy Events Button

document.getElementById('btn-copy').addEventListener('click', async () => {
  const visible = await filterVisibleEvents();
  
  if (visible.length === 0) {
    $('#btn-copy').tooltipster('content', 'No events!');
    setTimeout(() => {
      $('#btn-copy').tooltipster('content', 'Copy');
    }, 2000);
    return;
  }

  // Helper function
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

  // Group by date
  const grouped = {};
  visible.forEach(ev => {
    const dateStr = new Date(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(ev);
  });

  let text = '';
  Object.keys(grouped).forEach(date => {
    text += `${date}\n\n`;
    grouped[date].forEach(ev => {
      const time = new Date(ev.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const location = getReadableLocation(ev.location);
      text += `• ${ev.title} (${time})\n  ${ev.url}\n\n`;
    });
  });
  
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const visibleEvents = await filterVisibleEvents();  // get currently filtered/visible events
  if (visibleEvents.length === 0) {
    alert('No events to copy!');
    return;
  }

  const groupedByDate = {};
  visibleEvents.forEach(ev => {
    const full = fullEventMap.get(ev.id);
    if (!full) return;
  
    const date = new Date(full.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(full);
  });
  

  let htmlContent = '';
  let plainContent = '';

  for (const date in groupedByDate) {
    htmlContent += `<b>${date}</b><br><ul>`;
    plainContent += `${date}\n`;

    groupedByDate[date].forEach(ev => {
      const time = new Date(ev.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
      let city = ev.city || (ev.location?.locality) || 'Unknown city';
    
      let address = 'Unknown address';
      if (typeof ev.location === 'string') {
        address = ev.location;
      } else if (typeof ev.location === 'object' && ev.location !== null) {
        address = [
          ev.location.venue,
          ...(ev.location.address_lines || []),
          ev.location.locality,
          ev.location.region,
          ev.location.postal_code,
          ev.location.country
        ].filter(Boolean).join(', ');
      }
    
      htmlContent += `<li>${city} - <a href="${ev.url}">${ev.title}</a> - ${time} @ ${address}</li>`;
      plainContent += `• ${city} - ${ev.title} - ${time} @ ${address}\n`;
    });

    htmlContent += '</ul>';
    plainContent += '\n';
  }

  htmlContent += `<i>Created with <a href="https://protestfinder.net">protestfinder.net</a></i>`;
  plainContent += `Created with protestfinder.net`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plainContent], { type: 'text/plain' }),
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
      })
    ]);
  
    // ✅ SUCCESS → update button text/icon
    $('#btn-copy .icon').html("check");
    $('#btn-copy .text').html("Copied!");
    setTimeout(() => {
      $('#btn-copy .icon').html("content_copy");
      $('#btn-copy .text').html("Copy");
    }, 5000);
  
    console.log('✅ Events copied to clipboard');
  } catch (err) {
    console.error('❌ Failed to copy:', err);
    alert('Failed to copy events to clipboard.');
  }
});

// Info popup

document.getElementById('show-info-popup').addEventListener('click', () => {
  document.getElementById('info-popup').classList.add('active');
  document.getElementById('info-popup').classList.remove('hidden');
});

document.getElementById('close-info-popup').addEventListener('click', () => {
  document.getElementById('info-popup').classList.add('hidden');
  document.getElementById('info-popup').classList.remove('active');
});

document.getElementById('info-popup').addEventListener('click', (e) => {
  if (e.target.className === 'backdrop') {
    document.getElementById('info-popup').classList.remove('active');
    setTimeout(() => {
      document.getElementById('info-popup').classList.add('hidden');
    }, 300);
  }
});

// Modal open/close
document.getElementById('add-event-btn').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('modal-overlay').classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('active');
  setTimeout(() => {
    document.getElementById('modal-overlay').classList.add('hidden');
  }, 300);
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.className === 'backdrop') {
    document.getElementById('modal-overlay').classList.remove('active');
    setTimeout(() => {
      document.getElementById('modal-overlay').classList.add('hidden');
    }, 300);
  }
});

// === FORM SUBMISSION ===

if (window.location.href.indexOf("let-me-add") > -1) {
  document.getElementById('add-event-btn').classList.remove('hidden');
}

document.getElementById('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('title').value;
  const dateInput = document.getElementById('date').value;

  const hour = document.getElementById('start-hour').value;
  const minute = document.getElementById('start-minute').value;
  const ampm = document.getElementById('start-ampm').value;

  const timeInput = `${hour}:${minute} ${ampm}`;

  function convertTo24Hour(time12h) {
    const [time, modifier] = time12h.split(' ');
    let [hours, minutes] = time.split(':');

    if (hours === '12') {
      hours = '00';
    }

    if (modifier === 'PM') {
      hours = parseInt(hours, 10) + 12;
    }

    return `${hours}:${minutes}`;
  }

  const time24h = convertTo24Hour(timeInput);

  // Local date construction:
  const [year, month, day] = dateInput.split('-');
  const [hours, minutes] = time24h.split(':');

  const fullDateTime = new Date(
    parseInt(year),
    parseInt(month) - 1, // JS months are 0-indexed
    parseInt(day),
    parseInt(hours),
    parseInt(minutes)
  );

  const address = document.getElementById('address').value;
  const url = document.getElementById('url').value;

  try {
    const res = await fetch(`${API_BASE_URL}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const data = await res.json();
    
    if (!data || !data.latitude || !data.longitude) {
      alert('Location not found. Please try a more specific address.');
      return;
    }
    
    const { latitude, longitude } = data;

    const newEvent = {
      title,
      date: fullDateTime.toISOString(false),
      location: address,
      city: extractCity(address),
      latitude,
      longitude,
      url
    };

    console.log("New event added:", newEvent);

    try {
        const saveRes = await fetch(`${API_BASE_URL}/add-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEvent)
        });
  
        const result = await saveRes.json();
        console.log(result.message); // "Event saved!"
      } catch (err) {
        console.error('Error saving event:', err);
    }

    fetchedEvents.push(newEvent);
    newEvent.source = 'manual';  // Required so getFullEventDetails knows which source it came from
    fullEventMap.set(newEvent.id, newEvent);

    createEventMarker(newEvent);

    console.log('🛠 Regenerating event-locations.json after manual add...');
    await fetch('/regenerate-locations', { method: 'POST' });

    updateVisibleMapMarkers();
    updateVisibleListOnly();

    document.getElementById('modal-overlay').classList.remove('active');
    setTimeout(() => {
      document.getElementById('modal-overlay').classList.add('hidden');
    }, 300);

    e.target.reset();

  } catch (err) {
    console.error("Error during geocoding:", err);
    alert('Something went wrong. Please try again.');
  } 
});

const layoutContainer = document.getElementById("content-container");

function isMobile() {
  return window.innerWidth <= 900;
}

// Set default view on initial load (map view on mobile)
if (isMobile()) {
  layoutContainer.classList.add("mobile-map");
}

// Handle screen resizing
window.addEventListener("resize", () => {
  if (!isMobile()) {
    layoutContainer.classList.remove("mobile-map", "mobile-list");
  } else if (
    !layoutContainer.classList.contains("mobile-map") &&
    !layoutContainer.classList.contains("mobile-list")
  ) {
    layoutContainer.classList.add("mobile-map");
  }
});

// Toggle handlers
document.getElementById("btn-show-map").addEventListener("click", () => {
  if (isMobile()) {
    layoutContainer.classList.add("mobile-map");
    layoutContainer.classList.remove("mobile-list");
  }
  document.getElementById("btn-show-map").classList.add("active");
  document.getElementById("btn-show-list").classList.remove("active");

  // Refresh map size (important for Leaflet)
  setTimeout(() => {
    if (window.map && typeof window.map.invalidateSize === 'function') {
      window.map.invalidateSize();
    }
  }, 200);
});

document.getElementById("btn-show-list").addEventListener("click", async () => {
  if (isMobile()) {
    layoutContainer.classList.add("mobile-list");
    layoutContainer.classList.remove("mobile-map");
  }

  document.getElementById("btn-show-list").classList.add("active");
  document.getElementById("btn-show-map").classList.remove("active");

  // Trigger the list rendering and full data fetch if needed
  if (!isUpdatingList) {
    console.log('📥 List button clicked — triggering updateVisibleListOnly()');
    await updateVisibleListOnly();
  }
});

// === INITIAL LOAD ===
fetchEvents();
