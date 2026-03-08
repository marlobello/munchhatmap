import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { reverseGeocode } from './geocoding.js';
import { geocodeWithText, geocodeWithImage } from './aoai.js';
import type { MapPin } from '../types/mapPin.js';

export const TRIGGER_TAGS = (process.env.MAP_TRIGGER_TAGS ?? '#munchhat,#munchhatchronicles')
  .split(',')
  .map((t) => t.trim().toLowerCase());

export function detectTag(content: string): string | null {
  const lower = content.toLowerCase();
  return TRIGGER_TAGS.find((tag) => lower.includes(tag)) ?? null;
}

// Prepositions that commonly precede a location in Discord messages
const LOCATION_PREPOSITIONS = /^(in|at|near|from|around|visiting|eating\s+in|ate\s+in)\s+/i;

/**
 * Extracts a geocodable location string from message content.
 *
 * Strategy (in order):
 * 1. Remove the trigger hashtag.
 * 2. If the remaining text looks like a bare location (no sentence-like
 *    words), use it directly after stripping leading prepositions.
 * 3. If the message is a sentence, look for an explicit "in/at <Location>"
 *    pattern and extract just the location portion.
 * 4. Return null if nothing useful remains.
 */
export function extractLocationText(content: string): string | null {
  // Remove hashtag and surrounding whitespace
  let text = content.replace(/#munchhat(chronicles)?/gi, '').trim();

  // Remove trailing emoji and punctuation that confuse geocoders
  text = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}!?.,"]+\s*$/u, '').trim();

  if (!text) return null;

  // Strip leading preposition (e.g. "in Spring, TX" → "Spring, TX")
  text = text.replace(LOCATION_PREPOSITIONS, '').trim();

  // If the text looks like a simple "City, State/Country" or just a place
  // name (≤ 5 words, no verb-like lowercase words), return it directly.
  const wordCount = text.split(/\s+/).length;
  const looksLikeLocation = wordCount <= 5 && !/\b(the|had|was|have|got|went|ate|loved|tried|visited|check|great|good|best|amazing)\b/i.test(text);
  if (looksLikeLocation) return text;

  // For longer sentences, try to extract a "in/at <Location>" fragment.
  const match = text.match(/\b(?:in|at|near|from|around)\s+([A-Z][^.!?]*?)(?:\s*[.!?,]|$)/);
  if (match) return match[1].trim();

  // Last resort: if the whole remaining text is short enough, try it anyway.
  if (wordCount <= 8) return text;

  return null;
}

export function getImageAttachments(message: Message): { url: string; contentType: string }[] {
  return message.attachments
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => ({ url: a.url, contentType: a.contentType ?? 'image/jpeg' }));
}

export type ProcessResult = MapPin | 'no_tag' | 'no_image' | 'no_location';

/**
 * Attempts to build a MapPin from a Discord message.
 * Returns the pin on success or a string reason code on failure.
 */
export async function processMessageIntoPin(message: Message): Promise<ProcessResult> {
  if (!message.guildId) return 'no_tag';

  const tag = detectTag(message.content);
  if (!tag) return 'no_tag';

  const images = getImageAttachments(message);
  if (images.length === 0) return 'no_image';

  const imageUrl = images[0].url;

  // ── Step 1: EXIF GPS (most accurate — trust device GPS above all else)
  const gpsCoords = await extractGps(imageUrl);
  if (gpsCoords) {
    const location = await reverseGeocode(gpsCoords.lat, gpsCoords.lng);
    if (location) {
      console.log(`[pinProcessor] located via EXIF GPS: ${location.lat},${location.lng}`);
      return buildPin(message, imageUrl, tag, location);
    }
  }

  // ── Step 2: AOAI text geocoding (smart context understanding)
  const messageText = message.content.replace(/#munchhat(chronicles)?/gi, '').trim();
  if (messageText.length > 0) {
    const location = await geocodeWithText(messageText);
    if (location) {
      console.log(`[pinProcessor] located via AOAI text: ${location.lat},${location.lng}`);
      return buildPin(message, imageUrl, tag, location);
    }
  }

  // ── Step 3: AOAI vision (image recognition fallback)
  const location = await geocodeWithImage(imageUrl);
  if (location) {
    console.log(`[pinProcessor] located via AOAI vision: ${location.lat},${location.lng}`);
    return buildPin(message, imageUrl, tag, location);
  }

  return 'no_location';
}

function buildPin(
  message: Message,
  imageUrl: string,
  tag: string,
  location: { lat: number; lng: number; country?: string; state?: string },
): MapPin {
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
