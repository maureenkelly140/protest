function formatLocation(location) {
  if (typeof location === 'string') {
    return location;
  }

  if (typeof location === 'object' && location !== null) {
    return [
      location.venue,
      ...(location.address_lines || []),
      location.locality,
      location.region
      // location.postal_code,
      // location.country
    ].filter(Boolean).join(', ');
  }

  return 'Unknown location';
}

module.exports = { formatLocation };
