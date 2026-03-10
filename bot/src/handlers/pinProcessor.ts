import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { geocodeWithText, geocodeWithImage, reverseGeocodeWithAoai } from './aoai.js';
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
 *   1. EXIF GPS  → AOAI reverse geocode for country/state  (most accurate)
 *   2. AOAI text → extracts coords + country/state in one call
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
    let rawReverse: string | null = null;
    let reverseError: string | undefined;
    const location = await reverseGeocodeWithAoai(
      gpsCoords.lat, gpsCoords.lng,
      options.debugLog ? (r, e) => { rawReverse = r; reverseError = e; } : undefined,
    );
    options.debugLog?.push(
      `Step 1 (EXIF GPS): ${location ? '✅ resolved' : '❌ reverse geocode returned null'}\n` +
      `  GPS coords: ${gpsCoords.lat}, ${gpsCoords.lng}\n` +
      `  AOAI user message: "Coordinates: lat=${gpsCoords.lat}, lng=${gpsCoords.lng}"\n` +
      (reverseError
        ? `  AOAI error: ${reverseError}`
        : `  AOAI response: ${rawReverse ?? '(no response)'}`) +
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

  // ── Step 2: AOAI text geocoding — pass the full message, AOAI understands context
  const messageText = message.content.replace(/#munchhat(chronicles)?/gi, '').trim();
  const truncatedText = messageText.slice(0, 300);
  if (truncatedText.length > 0) {
    let rawTextResponse: string | null = null;
    let textError: string | undefined;
    const location = await geocodeWithText(
      truncatedText,
      options.debugLog ? (raw, e) => { rawTextResponse = raw; textError = e; } : undefined,
    );
    options.debugLog?.push(
      `Step 2 (AOAI text): ${location ? '✅ resolved' : '❌ no location found'}\n` +
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
    options.debugLog?.push(`Step 2 (AOAI text): message text was empty after stripping tags`);
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
