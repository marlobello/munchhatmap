import * as ExifReader from 'exifr';

export interface GpsCoordinates {
  lat: number;
  lng: number;
}

/**
 * Downloads the image from the given URL and attempts to extract GPS coordinates from EXIF data.
 * Returns null if no GPS data is found or extraction fails.
 */
export async function extractGps(imageUrl: string): Promise<GpsCoordinates | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const gps = await ExifReader.gps(buffer);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return { lat: gps.latitude, lng: gps.longitude };
    }
    return null;
  } catch (err) {
    console.error('[exif] Failed to extract GPS data:', err instanceof Error ? err.message : err);
    return null;
  }
}
