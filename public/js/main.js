const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://protest-finder.onrender.com';
  
  // === MAP SETUP ===
const map = L.map('map', { zoomControl: false }).setView([39.8283, -98.5795], 4);
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        map.setView([latitude, longitude], 10); // Zoom in closer to user's area
      },
      (error) => {
        console.warn('Geolocation not available or permission denied.');
        // No action needed — the default SF view stays
      }
    );
}
navigator.geolocation.getCurrentPosition(
    (position) => {
      console.log('GOT LOCATION:', position.coords.latitude, position.coords.longitude);
      map.setView([position.coords.latitude, position.coords.longitude], 10);
    },
    (error) => {
      console.warn('Geolocation error:', error.message);
    }
  );
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=MEOZ1SILbWpzsJ65uy1u', {
    tileSize: 512,
    zoomOffset: -1,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
    crossOrigin: true
  }).addTo(map);

// === GLOBAL VARIABLES ===
let allEvents = [];
let searchKeyword = '';
let eventMarkers = new Map();
let currentDateFilter = 'all'; // Default to "All" date filter

// === HELPER FUNCTIONS ===

// Marker icons
const normalIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [41, 41]
});

const highlightIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconSize: [35, 55],
  iconAnchor: [17, 55],
  popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [55, 55]
});

// Helper: Geocode an address using Nominatim
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

// Create Event Marker & Flyout
function createEventMarker(event) {
    const eventDate = new Date(event.date);
    const friendlyDate = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const friendlyTime = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const marker = L.marker([event.latitude, event.longitude], { icon: normalIcon })
        .addTo(map)
        .bindPopup(`
            <b>${event.title}</b><br>
            ${event.location}<br>
            ${friendlyDate} at ${friendlyTime}<br>
            <a href="${event.url}" target="_blank" rel="noopener noreferrer">View Details</a>
        `);

    eventMarkers.set(event, marker);
}
  

// === EVENT FETCHING ===
async function fetchEvents() {
    function showSkeletonLoader(count = 5) {
        const listContainer = document.getElementById('events');
        listContainer.innerHTML = ''; // clear anything
        for (let i = 0; i < count; i++) {
          const skeleton = document.createElement('div');
          skeleton.className = 'event skeleton';
          skeleton.innerHTML = `
            <div class="date-col"></div>
            <div class="detail-col"></div>
            <div class="btn-col"></div>
          `;
          listContainer.appendChild(skeleton);
        }
    }
    showSkeletonLoader();
    try {
      const res = await fetch(`${API_BASE_URL}/events`);
      const data = await res.json();
  
      // Clear the global events array
      allEvents = data.filter(event => event.approved !== false);

      console.log('Fetched events:', allEvents);
  
      // Draw the map markers
      allEvents.forEach(event => {

        console.log('Trying to create marker for:', event.title, event.latitude, event.longitude);

        if (event.latitude && event.longitude) {
          const eventDate = new Date(event.date);
          const friendlyDate = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const friendlyTime = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
          createEventMarker(event);
        }
      });
  
      updateVisibleEvents(); // Redraw the list initially
    } catch (err) {
      console.error("Error fetching events:", err);
      const listContainer = document.getElementById('events');
      listContainer.innerHTML = `<div class="null-msg">Error loading events. Check console for details.</div>`;
    }
}
  

// === EVENT LIST DRAWING ===
function updateVisibleEvents() {

    if (allEvents.length === 0) {
        return; // <-- Skip drawing until events are ready
    }

    const bounds = map.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
  
    // Get current time/date filtering info
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
  
    // FILTER events to those currently visible
    const visibleEvents = allEvents.filter(event => {
      const eventTime = new Date(event.date);
  
      const inBounds = (
        event.latitude >= southWest.lat &&
        event.latitude <= northEast.lat &&
        (southWest.lng <= northEast.lng
          ? (event.longitude >= southWest.lng && event.longitude <= northEast.lng)
          : (event.longitude >= southWest.lng || event.longitude <= northEast.lng)
        )
      );
  
      let matchesDate = false;
      if (currentDateFilter === 'today') {
        matchesDate = eventTime >= todayStart && eventTime < new Date(todayStart.getTime() + 86400000);
      } else if (currentDateFilter === 'week') {
        matchesDate = eventTime >= todayStart && eventTime <= weekEnd;
      } else {
        matchesDate = true; // "All"
      }
  
      const matchesSearch = (
        event.title.toLowerCase().includes(searchKeyword) ||
        event.location.toLowerCase().includes(searchKeyword)
      );
  
      return inBounds && matchesDate && matchesSearch;
    });
  
    // === CLEAR OLD MARKERS ===
    eventMarkers.forEach(marker => {
      map.removeLayer(marker);
    });
    eventMarkers.clear();
  
    // === CLEAR OLD LIST ===
    const listContainer = document.getElementById('events');
    listContainer.innerHTML = '';
  
    // === UPDATE COUNTER (if you have one) ===
    const counter = document.getElementById('event-counter');
    if (counter) {
      counter.innerHTML = visibleEvents.length > 0 
        ? `${visibleEvents.length} protest${visibleEvents.length !== 1 ? 's' : ''} found`
        : 'No protests found';
    }
  
    if (visibleEvents.length === 0) {
        listContainer.innerHTML = `
          <div class="null-msg">
            <p>No protests found in this area.</p>
            <button class="btn" id="reset-view-btn">Show All Protests</button>
          </div>
        `;
      
        // Add click listener to reset button
        document.getElementById('reset-view-btn').addEventListener('click', () => {
          // 1. Reset the map to whole US view
          map.flyTo([39.8283, -98.5795], 4, { // Nice USA center (latitude, longitude), zoom level 4
            animate: true,
            duration: 1 // seconds
          }); 
          
          // 2. Reset date filter to "all"
          currentDateFilter = 'all';
          document.getElementById('selected-filter').textContent = 'All Dates'; // Or whatever label you want
      
          // 3. Rebuild event list after resetting
          updateVisibleEvents();
        });
      
        return;
    }
  
    // === REBUILD LIST AND MARKERS ===
    visibleEvents.forEach(event => {
      const { title, date, location, url, latitude, longitude } = event;
      const eventDate = new Date(date);
      const friendlyDate = eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const friendlyTime = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
      // Add marker
      createEventMarker(event);
      const marker = eventMarkers.get(event);
  
      // Add list item
      const el = document.createElement('div');
      el.className = 'event';
      el.rel = 'noopener noreferrer';
      el.innerHTML = `
        <div class="date-col">
            <div class="date">${friendlyDate}</div>
            <div class="time">${friendlyTime}</div>
        </div>
        <div class="detail-col">
            <div class="event-title">${title}</div>
            <div class="event-description">${location}</div>
        </div>
        <div class="btn-col">
            <span class="icon material-symbols-outlined open-url-btn tooltip" title="View Details">open_in_new</span>
        </div>
      `;

      // Clicking the WHOLE ROW highlights the marker
      el.addEventListener('click', () => {
        if (marker) {
          marker.openPopup();
          marker.setIcon(highlightIcon);
        }
      });

      // Clicking just the small icon opens the external URL
      const openUrlBtn = el.querySelector('.open-url-btn');
      openUrlBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevents also triggering the row click
        window.open(url, '_blank');
      });
  
      listContainer.appendChild(el);
    });
  
    $('.tooltip').tooltipster({
      animation: 'fade',
      side: 'right'
    });
}

// === UI HANDLERS ===

// Search box input
document.getElementById('search-box').addEventListener('input', (e) => {
  searchKeyword = e.target.value.toLowerCase();
  updateVisibleEvents();
});

// Map moveend
map.on('moveend', updateVisibleEvents);

// Date filter dropdown (NEW)
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

  const loadingMessage = document.getElementById('loading');
  loadingMessage.style.display = 'block';

  try {
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;
    const res = await fetch(geocodeUrl);
    const data = await res.json();

    if (data.length === 0) {
      alert('Location not found. Please try a more specific address.');
      loadingMessage.style.display = 'none';
      return;
    }

    const latitude = parseFloat(data[0].lat);
    const longitude = parseFloat(data[0].lon);

    const newEvent = {
      title,
      date: fullDateTime.toISOString(false),
      location: address,
      latitude,
      longitude,
      url,
      approved: false
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

    allEvents.push(newEvent);

    // Don't create event immediately
    // createEventMarker(newEvent);
    // updateVisibleEvents();

    alert('Thanks for submitting! Your event has been submitted and will appear once it is reviewed.');

    document.getElementById('modal-overlay').classList.remove('active');
    setTimeout(() => {
      document.getElementById('modal-overlay').classList.add('hidden');
    }, 300);

    e.target.reset();

  } catch (err) {
    console.error("Error during geocoding:", err);
    alert('Something went wrong. Please try again.');
  } finally {
    loadingMessage.style.display = 'none';
  }
});

// === INITIALIZATION ===
fetchEvents();
