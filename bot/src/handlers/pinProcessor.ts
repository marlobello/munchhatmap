import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { geocodeText, reverseGeocode } from './geocoding.js';
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
  const gpsCoords = await extractGps(imageUrl);

  let location = gpsCoords ? await reverseGeocode(gpsCoords.lat, gpsCoords.lng) : null;

  // Fall back to text geocoding if EXIF had no GPS (reverseGeocode returns null only on error)
  if (!location) {
    const textForGeocoding = message.content
      .replace(/#munchhat(chronicles)?/gi, '')
      .trim();
    if (textForGeocoding.length > 0) {
      location = await geocodeText(textForGeocoding);
    }
  }

  if (!location) return 'no_location';

  return {
    id: randomUUID(),
    guildId: message.guildId,
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
