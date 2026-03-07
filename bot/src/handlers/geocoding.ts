import type { GpsCoordinates } from './exif.js';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'MunchHatMap/1.0 (https://github.com/marlo/munchhatmap)';

export interface LocationInfo extends GpsCoordinates {
  country?: string;
  state?: string;
}

// Nominatim rate limit: 1 request per second
let lastRequestAt = 0;

async function respectRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
  lastRequestAt = Date.now();
}

interface NominatimAddress {
  country?: string;
  country_code?: string;
  state?: string;
}

function extractLocationInfo(lat: number, lng: number, address?: NominatimAddress): LocationInfo {
  const isUS = address?.country_code?.toLowerCase() === 'us';
  return {
    lat,
    lng,
    country: address?.country,
    state: isUS ? address?.state : undefined,
  };
}

/**
 * Geocodes a free-form text string using Nominatim.
 * Returns lat/lng plus country and US state (if applicable), or null if not found.
 */
export async function geocodeText(text: string): Promise<LocationInfo | null> {
  if (!text || text.trim().length === 0) return null;

  try {
    await respectRateLimit();

    const params = new URLSearchParams({
      q: text.trim(),
      format: 'json',
      limit: '1',
      addressdetails: '1',
    });

    const response = await fetch(`${NOMINATIM_SEARCH}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[geocoding] Nominatim search returned ${response.status}`);
      return null;
    }

    const results = (await response.json()) as Array<{
      lat: string;
      lon: string;
      address?: NominatimAddress;
    }>;
    if (results.length === 0) return null;

    const { lat, lon, address } = results[0];
    return extractLocationInfo(parseFloat(lat), parseFloat(lon), address);
  } catch (err) {
    console.error('[geocoding] Nominatim search failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Reverse geocodes lat/lng coordinates to obtain country and US state.
 * Returns null if the request fails.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<LocationInfo | null> {
  try {
    await respectRateLimit();

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
    });

    const response = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[geocoding] Nominatim reverse returned ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { address?: NominatimAddress };
    return extractLocationInfo(lat, lng, result.address);
  } catch (err) {
    console.error('[geocoding] Nominatim reverse failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
