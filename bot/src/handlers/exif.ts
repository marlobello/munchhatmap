import exifr from 'exifr';

export interface GpsCoordinates {
  lat: number;
  lng: number;
}

const ALLOWED_IMAGE_HOSTS = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

/**
 * Downloads the image from the given URL and attempts to extract GPS coordinates from EXIF data.
 * Returns null if no GPS data is found or extraction fails.
 */
export async function extractGps(imageUrl: string): Promise<GpsCoordinates | null> {
  if (!ALLOWED_IMAGE_HOSTS.test(imageUrl)) {
    console.warn('[exif] Skipping fetch — URL is not a Discord CDN domain:', imageUrl);
    return null;
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const gps = await exifr.gps(buffer);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return { lat: gps.latitude, lng: gps.longitude };
    }
    return null;
  } catch (err) {
    console.error('[exif] Failed to extract GPS data:', err instanceof Error ? err.message : err);
    return null;
  }
}
