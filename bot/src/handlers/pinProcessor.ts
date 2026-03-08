import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { geocodeWithText, geocodeWithImage, reverseGeocodeWithAoai } from './aoai.js';
import type { LocationInfo } from './aoai.js';
import type { MapPin } from '../types/mapPin.js';

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

  const imageUrl = images[0].url;

  // ── Step 1: EXIF GPS (most accurate — trust device GPS above all else)
  const gpsCoords = await extractGps(imageUrl);
  if (gpsCoords) {
    const location = await reverseGeocodeWithAoai(gpsCoords.lat, gpsCoords.lng);
    if (location) {
      console.log(`[pinProcessor] located via EXIF GPS: ${location.lat},${location.lng}`);
      return buildPin(message, imageUrl, tag ?? 'munch-map-thread', location);
    }
  }

  // ── Step 2: AOAI text geocoding — pass the full message, AOAI understands context
  const messageText = message.content.replace(/#munchhat(chronicles)?/gi, '').trim();
  const truncatedText = messageText.slice(0, 300);
  if (truncatedText.length > 0) {
    const location = await geocodeWithText(truncatedText);
    if (location) {
      console.log(`[pinProcessor] located via AOAI text: ${location.lat},${location.lng}`);
      return buildPin(message, imageUrl, tag ?? 'munch-map-thread', location);
    }
  }

  // ── Step 3: AOAI vision (image recognition fallback)
  const location = await geocodeWithImage(imageUrl);
  if (location) {
    console.log(`[pinProcessor] located via AOAI vision: ${location.lat},${location.lng}`);
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
  };
}
