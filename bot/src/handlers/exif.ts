import exifr from 'exifr';
import { fetchWithTimeout } from './http.js';

export interface GpsCoordinates {
  lat: number;
  lng: number;
}

const ALLOWED_IMAGE_HOSTS = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

export interface GpsResult {
  coords: GpsCoordinates | null;
  /** Human-readable reason when coords is null — for debug logging. */
  reason: string;
}

/**
 * Downloads the image from the given URL and attempts to extract GPS coordinates from EXIF data.
 * Returns coords on success, or null with a reason string on failure.
 */
export async function extractGps(imageUrl: string): Promise<GpsResult> {
  if (!ALLOWED_IMAGE_HOSTS.test(imageUrl)) {
    const reason = `URL is not a Discord CDN domain: ${imageUrl}`;
    console.warn('[exif] Skipping fetch —', reason);
    return { coords: null, reason };
  }
  try {
    const response = await fetchWithTimeout(imageUrl);
    if (!response.ok) {
      const reason = `Image download failed: HTTP ${response.status} ${response.statusText}`;
      console.error('[exif]', reason);
      return { coords: null, reason };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const gps = await exifr.gps(buffer);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return { coords: { lat: gps.latitude, lng: gps.longitude }, reason: 'ok' };
    }
    return { coords: null, reason: 'no GPS metadata in image EXIF' };
  } catch (err) {
    const reason = `EXIF extraction error: ${err instanceof Error ? err.message : String(err)}`;
    console.error('[exif]', reason);
    return { coords: null, reason };
  }
}
