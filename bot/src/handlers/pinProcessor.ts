import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { geocodeWithText, geocodeWithImage, reverseGeocodeWithAoai, extractLocationQuery } from './aoai.js';
import { reverseGeocodeWithMaps, forwardGeocodeWithMaps, isMapsConfigured } from './maps.js';
import type { LocationInfo } from './aoai.js';
import type { MapPin } from '../types/mapPin.js';
import { uploadImageToBlob } from './storage.js';

export const TRIGGER_TAGS = (process.env.MAP_TRIGGER_TAGS ?? '#munchhat,#munchhatchronicles')
  .split(',')
  .map((t) => t.trim().toLowerCase());

export function detectTag(content: string): string | null {
  const lower = content.toLowerCase();
  return TRIGGER_TAGS.find((tag) => lower.includes(tag)) ?? null;
}

export function getImageAttachments(message: Message): { url: string; contentType: string }[] {
  return message.attachments
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => ({ url: a.url, contentType: a.contentType ?? 'image/jpeg' }));
}

export type ProcessResult = MapPin | 'no_tag' | 'no_image' | 'no_location';

export interface ProcessOptions {
  /** When true, skips the trigger tag check — all messages with images are processed. */
  skipTagCheck?: boolean;
  /** When provided, debug messages about each geocoding step are pushed into this array. */
  debugLog?: string[];
}

/**
 * Attempts to build a MapPin from a Discord message.
 * Returns the pin on success or a string reason code on failure.
 *
 * Geocoding pipeline:
 *   1. EXIF GPS  → Azure Maps reverse geocode (AOAI fallback)  (most accurate)
 *   2. Hybrid: AOAI extracts location query → Azure Maps resolves coordinates
 *      Fallback: AOAI full text geocoding (if Maps not configured or returns no result)
 *   3. AOAI vision → image recognition + country/state in one call
 */
export async function processMessageIntoPin(message: Message, options: ProcessOptions = {}): Promise<ProcessResult> {
  if (!message.guildId) return 'no_tag';

  const tag = detectTag(message.content);
  if (!tag && !options.skipTagCheck) return 'no_tag';

  const images = getImageAttachments(message);
  if (images.length === 0) return 'no_image';

  const { url: discordImageUrl, contentType } = images[0];

  // ── Step 1: EXIF GPS (most accurate — trust device GPS above all else)
  const exifResult = await extractGps(discordImageUrl);
  const gpsCoords = exifResult.coords;
  if (gpsCoords) {
    // Prefer Azure Maps for reverse geocoding (authoritative, cheap, deterministic).
    // Fall back to AOAI if Maps is not configured.
    let location: LocationInfo | null = null;
    let step1Method = 'Azure Maps';
    let rawReverse: string | null = null;
    let reverseError: string | undefined;

    if (isMapsConfigured()) {
      location = await reverseGeocodeWithMaps(gpsCoords.lat, gpsCoords.lng);
    }
    if (!location) {
      step1Method = 'AOAI (Maps fallback)';
      location = await reverseGeocodeWithAoai(
        gpsCoords.lat, gpsCoords.lng,
        options.debugLog ? (r, e) => { rawReverse = r; reverseError = e; } : undefined,
      );
    }

    options.debugLog?.push(
      `Step 1 (EXIF GPS via ${step1Method}): ${location ? '✅ resolved' : '❌ reverse geocode returned null'}\n` +
      `  GPS coords: ${gpsCoords.lat}, ${gpsCoords.lng}\n` +
      (step1Method.startsWith('AOAI')
        ? `  AOAI user message: "Coordinates: lat=${gpsCoords.lat}, lng=${gpsCoords.lng}"\n` +
          (reverseError
            ? `  AOAI error: ${reverseError}`
            : `  AOAI response: ${rawReverse ?? '(no response)'}`)
        : '') +
      (location ? `\n  Parsed: ${JSON.stringify({ lat: location.lat, lng: location.lng, country: location.country, state: location.state, place_name: location.place_name })}` : ''),
    );
    if (location) {
      console.log(`[pinProcessor] located via EXIF GPS: ${location.lat},${location.lng}`);
      const { url: imageUrl, error: blobError } = await uploadImageToBlob(discordImageUrl, message.id, contentType);
      options.debugLog?.push(
        blobError
          ? `Blob upload: ❌ ${blobError} — falling back to Discord CDN URL`
          : `Blob upload: ✅ ${imageUrl}`,
      );
      return buildPin(message, imageUrl, tag ?? 'munch-map-thread', location);
    }
  } else {
    options.debugLog?.push(`Step 1 (EXIF GPS): ℹ️ ${exifResult.reason}`);
  }

  // ── Step 2: Hybrid text geocoding
  //   2a. AOAI extracts a clean location query from conversational message text
  //   2b. Azure Maps resolves that query to authoritative coordinates
  //   Fallback: full AOAI text geocoding if Maps is not configured or returns no result
  const messageText = message.content.replace(/#munchhat(chronicles)?/gi, '').trim();
  const truncatedText = messageText.slice(0, 300);
  if (truncatedText.length > 0) {
    // Step 2a+2b: hybrid path
    if (isMapsConfigured()) {
      const locationQuery = await extractLocationQuery(truncatedText);
      if (locationQuery) {
        const mapsLocation = await forwardGeocodeWithMaps(locationQuery);
        if (mapsLocation) {
          options.debugLog?.push(
            `Step 2 (Hybrid: AOAI extract → Azure Maps): ✅ resolved\n` +
            `  Extracted query: "${locationQuery}"\n` +
            `  Parsed: ${JSON.stringify({ lat: mapsLocation.lat, lng: mapsLocation.lng, country: mapsLocation.country, state: mapsLocation.state, place_name: mapsLocation.place_name })}`,
          );
          console.log(`[pinProcessor] located via hybrid text+maps: ${mapsLocation.lat},${mapsLocation.lng}`);
          const { url: imageUrl, error: blobError } = await uploadImageToBlob(discordImageUrl, message.id, contentType);
          options.debugLog?.push(
            blobError
              ? `Blob upload: ❌ ${blobError} — falling back to Discord CDN URL`
              : `Blob upload: ✅ ${imageUrl}`,
          );
          return buildPin(message, imageUrl, tag ?? 'munch-map-thread', mapsLocation);
        }
        options.debugLog?.push(
          `Step 2a (AOAI extract): extracted "${locationQuery}" but Azure Maps returned no result — trying AOAI text fallback`,
        );
      } else {
        options.debugLog?.push(
          `Step 2a (AOAI extract): no location found in message text — trying AOAI text fallback`,
        );
      }
    }

    // Fallback: full AOAI text geocoding (Maps not configured, or hybrid yielded nothing)
    let rawTextResponse: string | null = null;
    let textError: string | undefined;
    const location = await geocodeWithText(
      truncatedText,
      options.debugLog ? (raw, e) => { rawTextResponse = raw; textError = e; } : undefined,
    );
    options.debugLog?.push(
      `Step 2 (AOAI text fallback): ${location ? '✅ resolved' : '❌ no location found'}\n` +
      `  AOAI user message: "Discord message: \\"${truncatedText}\\""\n` +
      (textError
        ? `  AOAI error: ${textError}`
        : `  AOAI response: ${rawTextResponse ?? '(no response)'}`) +
      (location ? `\n  Parsed: ${JSON.stringify({ lat: location.lat, lng: location.lng, country: location.country, state: location.state, place_name: location.place_name })}` : ''),
    );
    if (location) {
      console.log(`[pinProcessor] located via AOAI text: ${location.lat},${location.lng}`);
      const { url: imageUrl, error: blobError } = await uploadImageToBlob(discordImageUrl, message.id, contentType);
      options.debugLog?.push(
        blobError
          ? `Blob upload: ❌ ${blobError} — falling back to Discord CDN URL`
          : `Blob upload: ✅ ${imageUrl}`,
      );
      return buildPin(message, imageUrl, tag ?? 'munch-map-thread', location);
    }
  } else {
    options.debugLog?.push(`Step 2 (hybrid text): message text was empty after stripping tags`);
  }

  // ── Step 3: AOAI vision (image recognition fallback)
  let rawVisionResponse: string | null = null;
  let visionError: string | undefined;
  const location = await geocodeWithImage(
    discordImageUrl,
    options.debugLog ? (raw, e) => { rawVisionResponse = raw; visionError = e; } : undefined,
  );
  options.debugLog?.push(
    `Step 3 (AOAI vision): ${location ? '✅ resolved' : '❌ no location found'}\n` +
    `  Image URL: ${discordImageUrl}\n` +
    (visionError
      ? `  AOAI error: ${visionError}`
      : `  AOAI response: ${rawVisionResponse ?? '(no response)'}`) +
    (location ? `\n  Parsed: ${JSON.stringify({ lat: location.lat, lng: location.lng, country: location.country, state: location.state, place_name: location.place_name })}` : ''),
  );
  if (location) {
    console.log(`[pinProcessor] located via AOAI vision: ${location.lat},${location.lng}`);
    const { url: imageUrl, error: blobError } = await uploadImageToBlob(discordImageUrl, message.id, contentType);
    options.debugLog?.push(
      blobError
        ? `Blob upload: ❌ ${blobError} — falling back to Discord CDN URL`
        : `Blob upload: ✅ ${imageUrl}`,
    );
    return buildPin(message, imageUrl, tag ?? 'munch-map-thread', location);
  }

  return 'no_location';
}

function buildPin(message: Message, imageUrl: string, tag: string, location: LocationInfo): MapPin {
  return {
    id: randomUUID(),
    guildId: message.guildId!,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    username: message.author.username,
    lat: location.lat,
    lng: location.lng,
    imageUrl,
    createdAt: new Date(message.createdTimestamp).toISOString(),
    caption: message.content || undefined,
    tagUsed: tag,
    country: location.country,
    state: location.state,
    place_name: location.place_name,
  };
}
