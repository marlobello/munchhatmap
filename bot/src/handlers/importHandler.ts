import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  Collection,
  Message,
  Snowflake,
} from 'discord.js';
import { savePin, pinExistsByMessageId } from './db.js';
import { processMessageIntoPin } from './pinProcessor.js';

const MAP_URL = process.env.MAP_URL ?? '';
const DISCORD_MSG_BASE = 'https://discord.com/channels';

interface FailedMessage {
  url: string;
  reason: 'no_image' | 'no_location';
}

/** Splits a list of lines into chunks that each fit within Discord's 2000-char limit. */
function chunkLines(header: string, lines: string[], maxLen = 1950): string[] {
  const chunks: string[] = [];
  let current = header;
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current += (current.length ? '\n' : '') + line;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '❌ You need the **Manage Server** permission to run this command.',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !(channel instanceof TextChannel)) {
    await interaction.reply({ content: '❌ This command must be used in a text channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let imported = 0;
  let duplicates = 0;
  let lastMessageId: Snowflake | undefined;
  let totalScanned = 0;
  const failed: FailedMessage[] = [];

  console.log(`[import] Starting history scan of #${channel.name} (${channel.id})`);

  while (true) {
    let batch: Collection<Snowflake, Message>;
    try {
      batch = await channel.messages.fetch({
        limit: 100,
        ...(lastMessageId ? { before: lastMessageId } : {}),
      });
    } catch (err) {
      console.error('[import] Failed to fetch message batch:', err);
      break;
    }

    if (batch.size === 0) break;

    for (const message of batch.values()) {
      totalScanned++;
      const result = await processMessageIntoPin(message);

      if (result === 'no_tag') continue;

      const msgUrl = `${DISCORD_MSG_BASE}/${message.guildId}/${message.channelId}/${message.id}`;

      if (result === 'no_image') {
        failed.push({ url: msgUrl, reason: 'no_image' });
        continue;
      }

      if (result === 'no_location') {
        failed.push({ url: msgUrl, reason: 'no_location' });
        continue;
      }

      const exists = await pinExistsByMessageId(message.id, message.guildId!);
      if (exists) {
        duplicates++;
        continue;
      }

      try {
        await savePin(result);
        imported++;
      } catch (err) {
        console.error(`[import] Failed to save pin for message ${message.id}:`, err);
      }
    }

    lastMessageId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  console.log(
    `[import] Done. scanned=${totalScanned} imported=${imported} ` +
    `duplicates=${duplicates} failed=${failed.length}`,
  );

  const mapLink = MAP_URL ? `\n🗺️ [View the map](${MAP_URL})` : '';
  await interaction.editReply(
    `✅ **Import complete** — scanned ${totalScanned} messages\n` +
    `📍 Imported: **${imported}** new pin${imported !== 1 ? 's' : ''}\n` +
    `⏭️ Already mapped: **${duplicates}**\n` +
    `⚠️ Needs attention: **${failed.length}**` +
    mapLink,
  );

  if (failed.length === 0) return;

  // Send failure report as follow-up message(s), chunked to stay within Discord's 2000-char limit.
  const noImage   = failed.filter((f) => f.reason === 'no_image');
  const noLocation = failed.filter((f) => f.reason === 'no_location');

  const lines: string[] = [];
  if (noImage.length) {
    lines.push(`**📷 No image attached (${noImage.length}):**`);
    lines.push(...noImage.map((f) => `• ${f.url}`));
  }
  if (noLocation.length) {
    if (lines.length) lines.push('');
    lines.push(`**📍 No location found (${noLocation.length}):**`);
    lines.push(...noLocation.map((f) => `• ${f.url}`));
    lines.push('');
    lines.push('_Tip: edit the message to include a location like `Spring, Texas` then re-run `/munchhat-import`._');
  }

  const chunks = chunkLines('⚠️ **Messages that could not be mapped:**\n', lines);
  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk, ephemeral: false });
  }
}
