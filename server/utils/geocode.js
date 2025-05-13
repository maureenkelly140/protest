const fetch = require('node-fetch');

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${process.env.MAPBOX_API_KEY}&limit=1`;

  try {

    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const [lon, lat] = data.features[0].center;
      return {
        latitude: lat,
        longitude: lon
      };
    } else {
      return null;
    }
  } catch (err) {
    console.warn('⚠️ Mapbox geocoding error:', err.message);
    return null;
  }
}

module.exports = { geocodeAddress };
