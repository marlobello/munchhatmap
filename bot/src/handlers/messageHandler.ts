import { Message } from 'discord.js';
import { savePin } from './db.js';
import { processMessageIntoPin } from './pinProcessor.js';

const MAP_URL = process.env.MAP_URL ?? '';

async function tryReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply(content);
  } catch (err) {
    console.error('[messageHandler] Failed to send reply:', err instanceof Error ? err.message : err);
  }
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const result = await processMessageIntoPin(message);

  if (result === 'no_tag') return;

  if (result === 'no_image') {
    await tryReply(message, '📍 I see the tag but no image was attached. Please include a photo!');
    return;
  }

  if (result === 'no_location') {
    await tryReply(
      message,
      "📍 Couldn't find a location for this photo. " +
      'Make sure the image has GPS EXIF data, or add a location in your message text (e.g. `#munchhat Tokyo, Japan`).',
    );
    return;
  }

  try {
    await savePin(result);
  } catch (err) {
    console.error('[messageHandler] Failed to save pin:', err instanceof Error ? err.message : err);
    await tryReply(message, '❌ Sorry, something went wrong saving your pin. Please try again later.');
    return;
  }

  const mapLink = MAP_URL ? `\n🗺️ View the map: ${MAP_URL}` : '';
  await tryReply(message, `📍 Pin added at **${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}**!${mapLink}`);
}
