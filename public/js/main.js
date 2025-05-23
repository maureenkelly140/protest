// === CONFIGURATION ===
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://protest-finder.onrender.com';

// === GLOBAL STATE ===
let fetchedEvents = [];
let eventMarkers = new Map();
let currentDateFilter = 'all';
let searchKeyword = '';
let suppressEventListRefresh = false;

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

// === EVENT HANDLING ===
async function fetchEvents() {
  showSkeletonLoader();
  try {
    const res = await fetch(`${API_BASE_URL}/events`);
    const responseJson = await res.json();
    const rawEvents = Array.isArray(responseJson) ? responseJson : responseJson.events || [];
    fetchedEvents = rawEvents.filter(ev => ev.visible !== false);

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
    const matchesDate =
      currentDateFilter === 'all' ||
      (currentDateFilter === 'today' && time >= today && time < new Date(today.getTime() + 86400000)) ||
      (currentDateFilter === 'week' && time >= today && time <= weekEnd) ||
      (currentDateFilter === 'june14' &&
        time.getUTCFullYear() === 2025 &&
        time.getUTCMonth() === 5 &&
        time.getUTCDate() === 14);

    const matchesSearch =
      ev.title.toLowerCase().includes(searchKeyword) ||
      formatLocationClient(ev.location).toLowerCase().includes(searchKeyword);

    return inBounds && matchesDate && matchesSearch;
  });
}

function clearMarkersAndList(preservePopup = false) {
  if (!preservePopup) {
    map.closePopup();
  }

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

function createEventMarker(ev) {
  const marker = L.marker([ev.latitude, ev.longitude], { icon: normalIcon }).bindPopup(
    `<b>${ev.title}</b><br>${formatLocationClient(ev.location)}<br>${formatDateTime(ev.date).friendlyDate} at ${formatDateTime(ev.date).friendlyTime}<br><a href="${formatEventUrl(ev.url)}" target="_blank">View Details</a>`
  );
  markerClusterGroup.addLayer(marker);
  eventMarkers.set(ev, marker);
}

function renderVisibleEvents(list) {
  const eventListContainer = document.getElementById('events');
  const layoutContainer = document.getElementById('content-container'); // renamed to avoid conflict
  const counter = document.getElementById('event-counter');

  if (counter) {
    counter.innerHTML = list.length
      ? `${list.length} protest${list.length !== 1 ? 's' : ''} found`
      : 'No protests found';
  }

  if (list.length === 0) {
    eventListContainer.innerHTML = `
      <div class="null-msg">
        <p>No protests found in this area.</p>
        <button class="btn" id="reset-view-btn">Show All Protests</button>
      </div>`;
    
    document.getElementById('reset-view-btn').addEventListener('click', () => {
      map.flyTo([39.8283, -98.5795], 4);
      currentDateFilter = 'all';
      document.getElementById('selected-filter').textContent = 'All Dates';
      updateVisibleEvents();
    });

    return;
  }

  eventListContainer.innerHTML = ''; // clear previous

  list.forEach(ev => {
    const { title, date, location, url } = ev;
    const { friendlyDate, friendlyTime } = formatDateTime(date);
    createEventMarker(ev);

    el = document.createElement('a');
    el.className = 'event';
    el.href = formatEventUrl(url);
    el.target = isMobile() ? '_self' : '_blank'; // or always '_blank' if you prefer

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
      </div>
    `;

    // Handle main row click
    el.addEventListener('click', (e) => {
      if (!isMobile()) {
        e.preventDefault(); // prevent link on desktop
        const marker = eventMarkers.get(ev);
        if (marker) {
          suppressEventListRefresh = true;

          markerClusterGroup.zoomToShowLayer(marker, () => {
            marker.openPopup();
            updateVisibleListOnly();
          });
        }
      }
    });

    // Prevent row click from triggering when icon is clicked
    el.querySelector('.open-url-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(formatEventUrl(url), '_blank');
    });

    eventListContainer.appendChild(el);
  });

  // Tooltip setup
  $('.tooltip').tooltipster({ 
    animation: 'fade',
    theme: 'tooltipster-borderless',
    side: 'bottom',
    plugins: ['sideTip']
  });
}

function updateVisibleEvents(preservePopup = false) {
  clearMarkersAndList(preservePopup);
  const visible = filterVisibleEvents();
  renderVisibleEvents(visible);
}

function updateVisibleListOnly() {
  const visible = filterVisibleEvents();
  const eventListContainer = document.getElementById('events');
  const counter = document.getElementById('event-counter');

  if (counter) {
    counter.innerHTML = visible.length
      ? `${visible.length} protest${visible.length !== 1 ? 's' : ''} found`
      : 'No protests found';
  }

  if (visible.length === 0) {
    eventListContainer.innerHTML = `
      <div class="null-msg">
        <p>No protests found in this area.</p>
        <button class="btn" id="reset-view-btn">Show All Protests</button>
      </div>`;

    document.getElementById('reset-view-btn').addEventListener('click', () => {
      map.flyTo([39.8283, -98.5795], 4);
      currentDateFilter = 'all';
      document.getElementById('selected-filter').textContent = 'All Dates';
      updateVisibleEvents();  // Full reset
    });

    return;
  }

  eventListContainer.innerHTML = ''; // clear previous

  visible.forEach(ev => {
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
      </div>
    `;

    // Same marker interaction logic as before
    el.addEventListener('click', (e) => {
      if (!isMobile()) {
        e.preventDefault();
        const marker = eventMarkers.get(ev);
        if (marker) {
          suppressEventListRefresh = true;

          markerClusterGroup.zoomToShowLayer(marker, () => {
            marker.openPopup();

            // Instead of redrawing everything:
            setTimeout(() => {
              updateVisibleListOnly();  // ✅ just the list
            }, 600);
          });
        }
      }
    });

    el.querySelector('.open-url-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(formatEventUrl(url), '_blank');
    });

    eventListContainer.appendChild(el);
  });

  $('.tooltip').tooltipster({ 
    animation: 'fade',
    theme: 'tooltipster-borderless',
    side: 'bottom',
    plugins: ['sideTip']
  });
}

function updateVisibleListOnly() {
  const visible = filterVisibleEvents();
  const eventListContainer = document.getElementById('events');
  const counter = document.getElementById('event-counter');

  if (counter) {
    counter.innerHTML = visible.length
      ? `${visible.length} protest${visible.length !== 1 ? 's' : ''} found`
      : 'No protests found';
  }

  if (visible.length === 0) {
    eventListContainer.innerHTML = `
      <div class="null-msg">
        <p>No protests found in this area.</p>
        <button class="btn" id="reset-view-btn">Show All Protests</button>
      </div>`;

    document.getElementById('reset-view-btn').addEventListener('click', () => {
      map.flyTo([39.8283, -98.5795], 4);
      currentDateFilter = 'all';
      document.getElementById('selected-filter').textContent = 'All Dates';
      updateVisibleEvents();  // Full reset
    });

    return;
  }

  eventListContainer.innerHTML = ''; // clear previous

  visible.forEach(ev => {
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
      </div>
    `;

    // Same marker interaction logic as before
    el.addEventListener('click', (e) => {
      if (!isMobile()) {
        e.preventDefault();
        const marker = eventMarkers.get(ev);
        if (marker) {
          suppressEventListRefresh = true;

          markerClusterGroup.zoomToShowLayer(marker, () => {
            marker.openPopup();

            // Instead of redrawing everything:
            setTimeout(() => {
              updateVisibleListOnly();  // ✅ just the list
            }, 600);
          });
        }
      }
    });

    el.querySelector('.open-url-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(formatEventUrl(url), '_blank');
    });

    eventListContainer.appendChild(el);
  });

  $('.tooltip').tooltipster({ 
    animation: 'fade',
    theme: 'tooltipster-borderless',
    side: 'bottom',
    plugins: ['sideTip']
  });
}

// === UI HOOKS ===
document.getElementById('search-box').addEventListener('input', (e) => {
  searchKeyword = e.target.value.toLowerCase();
  updateVisibleEvents();
});

document.getElementById('date-filter').addEventListener('click', () => {
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

  if (suppressEventListRefresh) {
    suppressEventListRefresh = false;
    return;
  }

  if (fetchedEvents && fetchedEvents.length > 0) {
    const isPopupOpen = document.getElementsByClassName('leaflet-popup');
    if (isPopupOpen.length > 0) {
      // popup is open, do nothing
    } else {
      updateVisibleEvents();
    }
  }
});

// Copy Events Button

document.getElementById('btn-copy').addEventListener('click', () => {
  const visible = filterVisibleEvents();
  
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
  const visibleEvents = filterVisibleEvents();  // get currently filtered/visible events
  if (visibleEvents.length === 0) {
    alert('No events to copy!');
    return;
  }

  const groupedByDate = {};
  visibleEvents.forEach(ev => {
    const date = new Date(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(ev);
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

    createEventMarker(newEvent);

    updateVisibleEvents();

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
  return window.innerWidth <= 768;
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

document.getElementById("btn-show-list").addEventListener("click", () => {
  if (isMobile()) {
    layoutContainer.classList.add("mobile-list");
    layoutContainer.classList.remove("mobile-map");
  }
  document.getElementById("btn-show-list").classList.add("active");
  document.getElementById("btn-show-map").classList.remove("active");
});

// === INITIAL LOAD ===
fetchEvents();
