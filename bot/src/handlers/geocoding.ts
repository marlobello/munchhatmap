import type { GpsCoordinates } from './exif.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MunchHatMap/1.0 (https://github.com/marlo/munchhatmap)';

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

/**
 * Attempts to geocode a free-form text string using Nominatim (OpenStreetMap).
 * Returns null if no result is found or the request fails.
 */
export async function geocodeText(text: string): Promise<GpsCoordinates | null> {
  if (!text || text.trim().length === 0) return null;

  try {
    await respectRateLimit();

    const params = new URLSearchParams({
      q: text.trim(),
      format: 'json',
      limit: '1',
    });

    const response = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[geocoding] Nominatim returned ${response.status}`);
      return null;
    }

    const results = (await response.json()) as Array<{ lat: string; lon: string }>;
    if (results.length === 0) return null;

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch (err) {
    console.error('[geocoding] Nominatim request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
