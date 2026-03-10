/**
 * messageUpdateHandler.ts — handles Discord messageUpdate events.
 *
 * Fires the same munchhat processing pipeline as messageCreate when a user edits
 * a message to add the trigger tag and/or an image. Designed to be nearly zero-overhead
 * for the vast majority of edits that have nothing to do with munchhat:
 *
 *   1. Bot / not-in-guild  → immediate return, no I/O
 *   2. Partial message     → skip (old/uncached messages; user uses /munchhat-import instead)
 *   3. No munchhat tag     → immediate return, no I/O  (string check only)
 *   4. Pin already exists  → silent return  (one Cosmos query; protects moved/re-geocoded pins)
 *   5. No existing pin     → full handleMessage pipeline (same as messageCreate)
 */

import { Message, PartialMessage } from 'discord.js';
import { handleMessage } from './messageHandler.js';
import { pinExistsByMessageId } from './db.js';
import { TRIGGER_TAGS } from './pinProcessor.js';

export async function handleMessageUpdate(
  _oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  // Step 1: skip bots and non-guild messages
  if (newMessage.author?.bot) return;
  if (!newMessage.guildId) return;

  // Step 2: skip partial messages (not in Discord's cache = old message).
  // The target scenario — tag added seconds/minutes after posting — will always be cached.
  // Old edits should use /munchhat-import message:<url> instead.
  if (newMessage.partial) return;

  // Step 3: fast tag check — no I/O, exits immediately for the vast majority of edits
  const content = newMessage.content?.toLowerCase() ?? '';
  const hasTag = TRIGGER_TAGS.some((tag) => content.includes(tag));
  if (!hasTag) return;

  // Step 4: only Cosmos query in this handler — skip if already pinned
  const alreadyPinned = await pinExistsByMessageId(newMessage.id, newMessage.guildId);
  if (alreadyPinned) return;

  // Step 5: delegate to the full messageCreate pipeline
  await handleMessage(newMessage as Message);
}
