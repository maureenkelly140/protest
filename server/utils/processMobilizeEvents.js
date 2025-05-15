// === 📁 server/utils/processMobilizeEvents.js ===

const { geocodeAddress } = require('./geocode');

const alwaysIncludeTypes = ['RALLY', 'VISIBILITY_EVENT'];
const conditionalIncludeTypes = ['COMMUNITY_EVENT', 'SOLIDARITY_EVENT', 'OTHER'];

const protestWords = [
  'rally',
  'protest',
  'no kings',
  'march',
  'strike',
  'walkout'
  // add more as needed
];

const protestWordRegex = new RegExp(`\\b(${protestWords.join('|')})\\b`, 'i');

async function processMobilizeEvents(rawEvents, cutoffTime) {
  const results = [];

  for (const event of rawEvents) {
    const title = event.title || '(no title)';

    if (event.is_virtual) {
      results.push({ ...event, action: 'skipped: virtual event' });
      continue;
    }

    const type = event.event_type;

    if (alwaysIncludeTypes.includes(type)) {
      // proceed
    } else if (conditionalIncludeTypes.includes(type)) {
      if (!protestWordRegex.test(title)) {
        results.push({ ...event, action: `skipped: conditional type without protest word` });
        continue;
      }
    } else {
      results.push({ ...event, action: `skipped: blocked event_type ${type}` });
      continue;
    }

    const timeslots = Array.isArray(event.timeslots) ? event.timeslots : [];
    if (timeslots.length === 0) {
      results.push({ ...event, action: 'skipped: no timeslots' });
      continue;
    }

    const futureTimes = timeslots.filter(t => (t.start_date * 1000) > cutoffTime);
    const nextTimeslot = futureTimes.length > 0
      ? futureTimes.sort((a, b) => a.start_date - b.start_date)[0]
      : timeslots.sort((a, b) => b.start_date - a.start_date)[0];

    let latitude = event.location?.location?.latitude || event.location?.latitude;
    let longitude = event.location?.location?.longitude || event.location?.longitude;

    if (!latitude || !longitude) {
      const loc = event.location || {};
      const address = [
        loc.venue,
        ...(loc.address_lines || []),
        loc.locality,
        loc.region,
        loc.postal_code,
        loc.country
      ].filter(Boolean).join(', ');

      if (address) {
        const geo = await geocodeAddress(address);
        if (geo) {
          latitude = geo.latitude;
          longitude = geo.longitude;
        } else {
          results.push({ ...event, action: `skipped: failed geocode` });
          continue;
        }
      } else {
        results.push({ ...event, action: 'skipped: no usable address' });
        continue;
      }
    }

    if (latitude < 24 || latitude > 50 || longitude < -125 || longitude > -66) {
      results.push({ ...event, action: 'skipped: out-of-bounds coordinates' });
      continue;
    }

    results.push({
      ...event,
      city: event.location?.locality || '',
      latitude,
      longitude,
      date: new Date(nextTimeslot.start_date * 1000).toISOString(),
      url: event.browser_url || event.url || '',
      action: 'included',
      source: 'mobilize'
    });
  }

  return results;
}

module.exports = { processMobilizeEvents };
