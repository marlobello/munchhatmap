import { Message } from 'discord.js';
import { randomUUID } from 'crypto';
import { extractGps } from './exif.js';
import { geocodeText } from './geocoding.js';
import { savePin } from './db.js';
import type { MapPin } from '../types/mapPin.js';

const TRIGGER_TAGS = (process.env.MAP_TRIGGER_TAGS ?? '#munchhat,#munchhatchronicles')
  .split(',')
  .map((t) => t.trim().toLowerCase());

const MAP_URL = process.env.MAP_URL ?? '';

function detectTag(content: string): string | null {
  const lower = content.toLowerCase();
  return TRIGGER_TAGS.find((tag) => lower.includes(tag)) ?? null;
}

function getImageAttachments(message: Message): { url: string; contentType: string }[] {
  return message.attachments
    .filter((a) => a.contentType?.startsWith('image/'))
    .map((a) => ({ url: a.url, contentType: a.contentType ?? 'image/jpeg' }));
}

function buildDiscordMessageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const tag = detectTag(message.content);
  if (!tag) return;

  const images = getImageAttachments(message);
  if (images.length === 0) {
    await message.reply('📍 I see the tag but no image was attached. Please include a photo!');
    return;
  }

  const imageUrl = images[0].url;
  let coords = await extractGps(imageUrl);

  if (!coords) {
    // Geocoding fallback: strip trigger tags and try the remaining text
    const textForGeocoding = message.content
      .replace(/#munchhat(chronicles)?/gi, '')
      .trim();

    if (textForGeocoding.length > 0) {
      coords = await geocodeText(textForGeocoding);
    }
  }

  if (!coords) {
    await message.reply(
      "📍 Couldn't find a location for this photo. " +
      'Make sure the image has GPS EXIF data, or add a location in your message text (e.g. `#munchhat Tokyo, Japan`).',
    );
    return;
  }

  const pin: MapPin = {
    id: randomUUID(),
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    lat: coords.lat,
    lng: coords.lng,
    imageUrl,
    createdAt: new Date().toISOString(),
    caption: message.content || undefined,
    tagUsed: tag,
  };

  try {
    await savePin(pin);
  } catch (err) {
    console.error('[messageHandler] Failed to save pin:', err instanceof Error ? err.message : err);
    await message.reply('❌ Sorry, something went wrong saving your pin. Please try again later.');
    return;
  }

  const mapLink = MAP_URL ? `\n🗺️ View the map: ${MAP_URL}` : '';
  await message.reply(
    `📍 Pin added at **${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}**!${mapLink}`,
  );
}
