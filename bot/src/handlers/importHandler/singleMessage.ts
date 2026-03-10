/**
 * singleMessage.ts — handles single-message import mode for the munchhat-import command.
 * Supports force-location (AOAI override), force (re-geocode + overwrite), and normal pin.
 */

import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { randomUUID } from 'crypto';
import { savePin, upsertPin, getPinByMessageId } from '../db.js';
import { processMessageIntoPin } from '../pinProcessor.js';
import { geocodeWithText } from '../aoai.js';
import { uploadImageToBlob } from '../storage.js';
import type { Verbosity } from './types.js';

const DISCORD_MSG_BASE = 'https://discord.com/channels';

/**
 * Handles the single-message import mode.
 * Assumes `interaction.deferReply()` has already been called.
 */
export async function handleSingleMessage(
  interaction: ChatInputCommandInteraction,
  messageUrl: string,
  forceLocation: string | null,
  force: boolean,
  verbosity: Verbosity,
): Promise<void> {
  const match = messageUrl.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) {
    await interaction.editReply('❌ Could not parse message link. Expected: `https://discord.com/channels/GUILD/CHANNEL/MESSAGE`');
    return;
  }
  const [, msgGuildId, msgChannelId, msgId] = match;
  if (msgGuildId !== interaction.guildId) {
    await interaction.editReply('❌ That message link is from a different server.');
    return;
  }
  try {
    const msgChannel = await interaction.client.channels.fetch(msgChannelId);
    if (!(msgChannel instanceof TextChannel)) {
      await interaction.editReply('❌ Could not access the channel for that message.');
      return;
    }
    const message = await msgChannel.messages.fetch(msgId);
    const existingPin = await getPinByMessageId(message.id, message.guildId!);
    const jumpUrl = `${DISCORD_MSG_BASE}/${message.guildId}/${message.channelId}/${message.id}`;

    if (forceLocation) {
      await handleForceLocation(interaction, message, existingPin, forceLocation, verbosity, jumpUrl);
      return;
    }

    if (existingPin && !force) {
      await interaction.editReply('⏭️ That message is already mapped. Use `force:True` to overwrite it.');
      return;
    }

    await handleNormalSingle(interaction, message, existingPin, force, verbosity, jumpUrl);
  } catch (err) {
    console.error('[import] Single message import failed:', err);
    await interaction.editReply('❌ Failed to fetch or process that message.');
  }
}

async function handleForceLocation(
  interaction: ChatInputCommandInteraction,
  message: import('discord.js').Message,
  existingPin: Awaited<ReturnType<typeof getPinByMessageId>>,
  forceLocation: string,
  verbosity: Verbosity,
  jumpUrl: string,
): Promise<void> {
  const debugInfo: string[] = [];
  let rawResponse: string | null = null;
  let aoaiError: string | undefined;
  const location = await geocodeWithText(
    forceLocation,
    verbosity === 'debug' ? (raw, e) => { rawResponse = raw; aoaiError = e; } : undefined,
  );
  if (verbosity === 'debug') {
    debugInfo.push(`Sending to AOAI: "${forceLocation}"`);
    debugInfo.push(aoaiError
      ? `AOAI error: ${aoaiError}`
      : `Raw AOAI response: ${rawResponse ?? '(no response)'}`);
  }
  if (!location) {
    let reply = `📍 AOAI could not determine coordinates for \`${forceLocation}\`.`;
    if (verbosity === 'debug' && debugInfo.length) {
      reply += '\n\n**Debug:**\n' + debugInfo.map((l) => `> ${l}`).join('\n');
    }
    await interaction.editReply(reply);
    return;
  }
  const rawDiscordUrl = message.attachments.first()?.url;
  const contentType = message.attachments.first()?.contentType ?? 'image/jpeg';
  let imageUrl: string;
  if (rawDiscordUrl) {
    const { url, error: blobError } = await uploadImageToBlob(rawDiscordUrl, message.id, contentType);
    imageUrl = url;
    if (verbosity === 'debug') {
      debugInfo.push(blobError
        ? `Blob upload: ❌ ${blobError} — falling back to Discord CDN URL`
        : `Blob upload: ✅ ${url}`);
    }
  } else {
    imageUrl = existingPin?.imageUrl ?? '';
    if (verbosity === 'debug') debugInfo.push('Blob upload: ℹ️ no attachment on message — reusing existing image URL');
  }
  const pin = {
    id: existingPin?.id ?? randomUUID(),
    guildId: message.guildId!,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    username: message.author.username,
    lat: location.lat,
    lng: location.lng,
    imageUrl,
    createdAt: existingPin?.createdAt ?? new Date(message.createdTimestamp).toISOString(),
    caption: message.content || existingPin?.caption,
    tagUsed: existingPin?.tagUsed ?? 'force-location',
    country: location.country,
    state: location.state ?? undefined,
    place_name: location.place_name,
  };
  await upsertPin(pin);
  if (verbosity === 'debug') debugInfo.push(`Cosmos DB: ✅ ${existingPin ? 'Updated' : 'Saved'} pin ${pin.id}`);
  const action = existingPin ? '🔄 Updated' : '✅ Pinned';
  let reply = `${action}! **${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}** — ${pin.place_name ?? pin.country ?? forceLocation}`;
  if (verbosity === 'debug' && debugInfo.length) {
    reply += '\n\n**Debug:**\n' + debugInfo.map((l) => `> ${l}`).join('\n');
  }
  await interaction.editReply(reply);
}

async function handleNormalSingle(
  interaction: ChatInputCommandInteraction,
  message: import('discord.js').Message,
  existingPin: Awaited<ReturnType<typeof getPinByMessageId>>,
  force: boolean,
  verbosity: Verbosity,
  jumpUrl: string,
): Promise<void> {
  const debugInfo: string[] = [];
  const result = await processMessageIntoPin(message, {
    skipTagCheck: force,
    debugLog: verbosity === 'debug' ? debugInfo : undefined,
  });
  if (result === 'no_tag') {
    await interaction.editReply('⚠️ That message doesn\'t contain a `#munchhat` tag.');
  } else if (result === 'no_image') {
    await interaction.editReply('⚠️ That message doesn\'t have an image attached.');
  } else if (result === 'no_location') {
    let reply = `📍 Could not determine location for ${jumpUrl}`;
    if (verbosity === 'debug' && debugInfo.length) {
      reply += '\n\n**Debug:**\n' + debugInfo.map((l) => `> ${l}`).join('\n');
    }
    await interaction.editReply(reply);
  } else {
    if (force && existingPin) {
      result.id = existingPin.id;
      await upsertPin(result);
      debugInfo.push(`Cosmos DB: ✅ Updated pin ${result.id}`);
      let reply = `🔄 Updated! **${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}** — ${result.place_name ?? result.country ?? 'unknown location'}`;
      if (verbosity === 'debug' && debugInfo.length) {
        reply += '\n\n**Debug:**\n' + debugInfo.map((l) => `> ${l}`).join('\n');
      }
      await interaction.editReply(reply);
    } else {
      await savePin(result);
      debugInfo.push(`Cosmos DB: ✅ Saved pin ${result.id}`);
      let reply = `✅ Pinned! **${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}** — ${result.place_name ?? result.country ?? 'unknown location'}`;
      if (verbosity === 'debug' && debugInfo.length) {
        reply += '\n\n**Debug:**\n' + debugInfo.map((l) => `> ${l}`).join('\n');
      }
      await interaction.editReply(reply);
    }
  }
}
