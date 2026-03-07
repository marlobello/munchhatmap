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
  let noLocation = 0;
  let lastMessageId: Snowflake | undefined;
  let totalScanned = 0;

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
      if (result === 'no_image') continue;

      if (result === 'no_location') {
        noLocation++;
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

  console.log(`[import] Done. scanned=${totalScanned} imported=${imported} duplicates=${duplicates} noLocation=${noLocation}`);

  const mapLink = MAP_URL ? `\n🗺️ [View the map](${MAP_URL})` : '';
  await interaction.editReply(
    `✅ **Import complete** — scanned ${totalScanned} messages\n` +
    `📍 Imported: **${imported}** new pin${imported !== 1 ? 's' : ''}\n` +
    `⏭️ Already mapped: **${duplicates}**\n` +
    `🚫 No location found: **${noLocation}**` +
    mapLink,
  );
}
