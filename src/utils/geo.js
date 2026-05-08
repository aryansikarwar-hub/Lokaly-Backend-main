/**
 * Geo utilities for Lokaly hyperlocal feature.
 *
 * - Haversine distance (km) between two [lng, lat] points
 * - Delivery ETA classification (same-day / next-day / standard)
 * - GeoJSON helpers
 *
 * NOTE: Mongo stores coordinates as [longitude, latitude] (GeoJSON convention).
 * We follow the same order everywhere to avoid bugs.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance between two points.
 * @param {[number,number]} a - [lng, lat]
 * @param {[number,number]} b - [lng, lat]
 * @returns {number} distance in km
 */
function haversineKm(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Classify delivery ETA based on distance from seller to buyer.
 * Tweak these thresholds in one place.
 */
function classifyDelivery(distanceKm) {
  if (distanceKm == null || !Number.isFinite(distanceKm)) {
    return { tier: "standard", label: "Ships in 2–4 days", etaDays: 3 };
  }
  if (distanceKm <= 5) {
    return { tier: "same_day", label: "Same-day delivery", etaDays: 0 };
  }
  if (distanceKm <= 15) {
    return { tier: "next_day", label: "Next-day delivery", etaDays: 1 };
  }
  if (distanceKm <= 50) {
    return { tier: "two_day", label: "Delivers in 2 days", etaDays: 2 };
  }
  return { tier: "standard", label: "Ships in 2–4 days", etaDays: 3 };
}

/**
 * Validate and normalize a [lng, lat] pair from query params.
 * Returns null if invalid.
 */
function parseLngLat(lngRaw, latRaw) {
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/**
 * Build a GeoJSON Point.
 */
function toPoint([lng, lat]) {
  return { type: "Point", coordinates: [lng, lat] };
}

module.exports = {
  haversineKm,
  classifyDelivery,
  parseLngLat,
  toPoint,
  EARTH_RADIUS_KM,
};
