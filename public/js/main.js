// === CONFIGURATION ===
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://protest-finder.onrender.com';

// === GLOBAL STATE ===
let fetchedEvents = [];
let eventMarkers = new Map();
let currentDateFilter = 'all';
let searchKeyword = '';

// === MAP SETUP ===
const map = L.map('map', { zoomControl: false }).setView([39.8283, -98.5795], 4);
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

// === EVENT HANDLING ===
async function fetchEvents() {
  showSkeletonLoader();
  try {
    const res = await fetch(`${API_BASE_URL}/events`);
    const responseJson = await res.json();
    const rawEvents = Array.isArray(responseJson) ? responseJson : responseJson.events || [];
    fetchedEvents = rawEvents.filter(ev => ev.approved !== false);

    // Only call updateVisibleEvents after data is ready
    updateVisibleEvents();
  } catch (err) {
    console.error('Error fetching events:', err);
    showErrorMsg();
  }
}

function filterVisibleEvents() {
  const bounds = map.getBounds();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);

  return fetchedEvents.filter(ev => {
    const time = new Date(ev.date);
    const inBounds = bounds.contains([ev.latitude, ev.longitude]);
    const matchesDate = currentDateFilter === 'all' ||
      (currentDateFilter === 'today' && time >= today && time < new Date(today.getTime() + 86400000)) ||
      (currentDateFilter === 'week' && time >= today && time <= weekEnd) ||
      (currentDateFilter === 'june14' && time.getUTCFullYear() === 2025 && time.getUTCMonth() === 5 && time.getUTCDate() === 14);

    const matchesSearch = ev.title.toLowerCase().includes(searchKeyword) || ev.location.toLowerCase().includes(searchKeyword);
    return inBounds && matchesDate && matchesSearch;
  });
}

function clearMarkersAndList() {
  eventMarkers.forEach(marker => map.removeLayer(marker));
  eventMarkers.clear();
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

function createEventMarker(ev) {
  const marker = L.marker([ev.latitude, ev.longitude], { icon: normalIcon }).addTo(map).bindPopup(
    `<b>${ev.title}</b><br>${formatLocationClient(ev.location)}<br>${formatDateTime(ev.date).friendlyDate} at ${formatDateTime(ev.date).friendlyTime}<br><a href="${formatEventUrl(ev.url)}" target="_blank">View Details</a>`
  );
  eventMarkers.set(ev, marker);
}




function renderVisibleEvents(list) {
  const container = document.getElementById('events');
  const counter = document.getElementById('event-counter');
  if (counter) counter.innerHTML = list.length ? `${list.length} protest${list.length !== 1 ? 's' : ''} found` : 'No protests found';

  if (list.length === 0) {
    container.innerHTML = `<div class="null-msg"><p>No protests found in this area.</p><button class="btn" id="reset-view-btn">Show All Protests</button></div>`;
    document.getElementById('reset-view-btn').addEventListener('click', () => {
      map.flyTo([39.8283, -98.5795], 4);
      currentDateFilter = 'all';
      document.getElementById('selected-filter').textContent = 'All Dates';
      updateVisibleEvents();
    });
    return;
  }

  list.forEach(ev => {
    const { title, date, location, url } = ev;
    const { friendlyDate, friendlyTime } = formatDateTime(date);
    createEventMarker(ev);

    const el = document.createElement('div');
    el.className = 'event';
    el.innerHTML = `
      <div class="date-col"><div class="date">${friendlyDate}</div><div class="time">${friendlyTime}</div></div>
      <div class="detail-col"><div class="event-title">${title}</div><div class="event-description">${formatLocationClient(location)}</div></div>
      <div class="btn-col"><span class="icon material-symbols-outlined open-url-btn tooltip" title="View Details">open_in_new</span></div>`;

    el.addEventListener('click', () => eventMarkers.get(ev)?.openPopup());
    el.querySelector('.open-url-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(formatEventUrl(url), '_blank');
    });

    container.appendChild(el);
  });

  $('.tooltip').tooltipster({ animation: 'fade', side: 'right' });
}

function updateVisibleEvents() {
  clearMarkersAndList();
  const visible = filterVisibleEvents();
  renderVisibleEvents(visible);
}

// === UI HOOKS ===
document.getElementById('search-box').addEventListener('input', (e) => {
  searchKeyword = e.target.value.toLowerCase();
  updateVisibleEvents();
});

document.getElementById('selected-filter').addEventListener('click', () => {
  document.getElementById('filter-options').classList.toggle('hidden');
});

document.querySelectorAll('.dropdown-option').forEach(option => {
  option.addEventListener('click', () => {
    currentDateFilter = option.dataset.filter;
    document.getElementById('selected-filter').textContent = option.textContent;
    document.getElementById('filter-options').classList.add('hidden');
    updateVisibleEvents();
  });
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('date-filter').contains(e.target)) {
    document.getElementById('filter-options').classList.add('hidden');
  }
});

map.on('moveend', () => {
  if (fetchedEvents && fetchedEvents.length > 0) {

    //If a popup is already open on the map, don't refresh the results when the map moves
    var isPopupOpen = document.getElementsByClassName('leaflet-popup');
    if (isPopupOpen.length > 0) {
        // a popup is open
    } else {
      updateVisibleEvents();
    }
  }
});

// === INITIAL LOAD ===
fetchEvents();
