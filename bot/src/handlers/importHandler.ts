import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  ThreadChannel,
  Collection,
  Message,
  Snowflake,
} from 'discord.js';
import { savePin, pinExistsByMessageId } from './db.js';
import { processMessageIntoPin } from './pinProcessor.js';

const MAP_URL = process.env.MAP_URL ?? '';
const DISCORD_MSG_BASE = 'https://discord.com/channels';
const IMPORT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per user per channel

/** userId:channelId → last import timestamp */
const lastImportTime = new Map<string, number>();

type Verbosity = 'standard' | 'verbose' | 'debug';

interface FailedMessage {
  url: string;
  reason: 'no_image' | 'no_location';
  username: string;
  debugInfo?: string[];
}

/**
 * Parses a lookback string like "7d", "2w", "3M", "1y" into a cutoff Date.
 * Returns null if the string is invalid.
 * Units: m=minutes, h=hours, d=days, w=weeks, M=months, y=years
 */
function parseLookback(value: string): Date | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(m|h|d|w|M|y)$/);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  const unit = match[2];
  const ms: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 7 * 86_400_000,
    M: 30 * 86_400_000,
    y: 365 * 86_400_000,
  };
  return new Date(Date.now() - amount * ms[unit]);
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
  // ── Permission check
  const hasManageServer = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  const modRole = interaction.guild?.roles.cache.find((r) => r.name.toLowerCase() === 'mod');
  const memberHasModRole =
    modRole &&
    (interaction.member?.roles as { cache: { has: (id: string) => boolean } })?.cache?.has(modRole.id);

  const elevated = hasManageServer || memberHasModRole;
  const filterUserId = elevated ? null : interaction.user.id;

  // ── Parse options
  const verbosity = (interaction.options.getString('verbosity') ?? 'verbose') as Verbosity;
  const lookbackStr = interaction.options.getString('lookback');
  const messageUrl = interaction.options.getString('message');
  const targetChannelOption = interaction.options.getChannel('channel');

  // Parse lookback into a cutoff date
  let cutoffDate: Date | null = null;
  if (lookbackStr) {
    cutoffDate = parseLookback(lookbackStr);
    if (!cutoffDate) {
      await interaction.reply({
        content: `❌ Invalid lookback format \`${lookbackStr}\`. Use a number + unit, e.g. \`7d\`, \`2w\`, \`3M\`, \`1y\`, \`6h\`.`,
        ephemeral: true,
      });
      return;
    }
  }

  // Ensure we are in a text channel (needed for the reply)
  const replyChannel = interaction.channel;
  if (!replyChannel || !(replyChannel instanceof TextChannel)) {
    await interaction.reply({ content: '❌ This command must be used in a text channel.', ephemeral: true });
    return;
  }

  // Resolve the channel to scan (may differ from the interaction channel)
  let scanChannel: TextChannel;
  if (targetChannelOption) {
    if (!(targetChannelOption instanceof TextChannel)) {
      await interaction.reply({ content: '❌ Target channel must be a text channel.', ephemeral: true });
      return;
    }
    scanChannel = targetChannelOption;
  } else {
    scanChannel = replyChannel;
  }

  // ── Rate limit (keyed on scan channel)
  const cooldownKey = `${interaction.user.id}:${scanChannel.id}`;
  const lastRun = lastImportTime.get(cooldownKey) ?? 0;
  const remaining = IMPORT_COOLDOWN_MS - (Date.now() - lastRun);
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60000);
    await interaction.reply({
      content: `⏳ Please wait ${mins} more minute${mins !== 1 ? 's' : ''} before running the import again.`,
      ephemeral: true,
    });
    return;
  }
  lastImportTime.set(cooldownKey, Date.now());

  await interaction.deferReply();

  const scopeNote = elevated ? 'all messages' : 'your messages only';
  let imported = 0;
  let duplicates = 0;
  let totalScanned = 0;
  const failed: FailedMessage[] = [];

  // ── Single-message mode
  if (messageUrl) {
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
      const alreadyExists = await pinExistsByMessageId(message.id, message.guildId!);
      if (alreadyExists) {
        await interaction.editReply('⏭️ That message is already mapped.');
        return;
      }
      const debugInfo: string[] = [];
      const result = await processMessageIntoPin(message, {
        skipTagCheck: false,
        debugLog: verbosity === 'debug' ? debugInfo : undefined,
      });
      const jumpUrl = `${DISCORD_MSG_BASE}/${message.guildId}/${message.channelId}/${message.id}`;
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
        await savePin(result);
        await interaction.editReply(
          `✅ Pinned! **${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}** — ${result.place_name ?? result.country ?? 'unknown location'}`,
        );
      }
    } catch (err) {
      console.error('[import] Single message import failed:', err);
      await interaction.editReply('❌ Failed to fetch or process that message.');
    }
    return;
  }

  // ── Channel scan helper
  async function scanSource(source: TextChannel | ThreadChannel, skipTagCheck: boolean): Promise<void> {
    let lastMessageId: Snowflake | undefined;
    console.log(`[import] Scanning ${skipTagCheck ? 'thread' : 'channel'} #${source.name} (${source.id}) cutoff=${cutoffDate?.toISOString() ?? 'none'}`);

    while (true) {
      let batch: Collection<Snowflake, Message>;
      try {
        batch = await source.messages.fetch({
          limit: 100,
          ...(lastMessageId ? { before: lastMessageId } : {}),
        });
      } catch (err) {
        console.error(`[import] Failed to fetch messages from ${source.name}:`, err);
        break;
      }
      if (batch.size === 0) break;

      let hitCutoff = false;
      for (const message of batch.values()) {
        if (cutoffDate && message.createdAt < cutoffDate) {
          hitCutoff = true;
          continue;
        }
        totalScanned++;
        if (filterUserId && message.author.id !== filterUserId) continue;

        const alreadyExists = await pinExistsByMessageId(message.id, message.guildId!);
        if (alreadyExists) { duplicates++; continue; }

        const debugInfo: string[] = [];
        const result = await processMessageIntoPin(message, {
          skipTagCheck,
          debugLog: verbosity === 'debug' ? debugInfo : undefined,
        });

        if (result === 'no_tag') continue;

        const msgUrl = `${DISCORD_MSG_BASE}/${message.guildId}/${message.channelId}/${message.id}`;

        if (result === 'no_image') {
          if (!skipTagCheck) failed.push({ url: msgUrl, reason: 'no_image', username: message.author.username });
          continue;
        }
        if (result === 'no_location') {
          failed.push({ url: msgUrl, reason: 'no_location', username: message.author.username, debugInfo: debugInfo.length ? debugInfo : undefined });
          continue;
        }
        try {
          await savePin(result);
          imported++;
        } catch (err) {
          console.error(`[import] Failed to save pin for message ${message.id}:`, err);
        }
      }

      if (hitCutoff) break;
      lastMessageId = batch.last()?.id;
      if (batch.size < 100) break;
    }
  }

  // ── Scan main channel (tag required)
  await scanSource(scanChannel, false);

  // ── Scan "Munch Map" thread if it exists (no tag required — all images are candidates)
  const MUNCH_MAP_THREAD = 'munch map';
  let threadScanned = false;
  try {
    const [activeThreads, archivedThreads] = await Promise.all([
      scanChannel.threads.fetchActive(),
      scanChannel.threads.fetchArchived(),
    ]);
    const munchMapThread = [
      ...activeThreads.threads.values(),
      ...archivedThreads.threads.values(),
    ].find((t) => t.name.toLowerCase() === MUNCH_MAP_THREAD);
    if (munchMapThread) {
      threadScanned = true;
      await scanSource(munchMapThread, true);
    } else {
      console.log(`[import] No thread named "${MUNCH_MAP_THREAD}" found in #${scanChannel.name}`);
    }
  } catch (err) {
    console.error('[import] Failed to fetch threads:', err);
  }

  console.log(`[import] Done. scanned=${totalScanned} imported=${imported} duplicates=${duplicates} failed=${failed.length} threadScanned=${threadScanned}`);

  // ── Summary reply
  const mapLink = MAP_URL ? `\n🗺️ [View the map](${MAP_URL})` : '';
  const threadNote = threadScanned ? '\n🧵 Also scanned **Munch Map** thread' : '';
  const channelNote = targetChannelOption ? `\n📂 Scanned: <#${scanChannel.id}>` : '';
  const lookbackNote = cutoffDate ? `\n🕐 Lookback: \`${lookbackStr}\` (since <t:${Math.floor(cutoffDate.getTime() / 1000)}:f>)` : '';

  await interaction.editReply(
    `✅ **Import complete** (${scopeNote})` +
    channelNote + lookbackNote +
    `\n📊 Scanned ${totalScanned} messages\n` +
    `📍 Imported: **${imported}** new pin${imported !== 1 ? 's' : ''}\n` +
    `⏭️ Already mapped: **${duplicates}**\n` +
    `⚠️ Needs attention: **${failed.length}**` +
    threadNote + mapLink,
  );

  // Standard verbosity: counts only, no failure details
  if (verbosity === 'standard' || failed.length === 0) return;

  // Verbose / debug: send failure report as chunked follow-up(s)
  const noImage    = failed.filter((f) => f.reason === 'no_image');
  const noLocation = failed.filter((f) => f.reason === 'no_location');

  const lines: string[] = [];
  if (noImage.length) {
    lines.push(`**📷 No image attached (${noImage.length}):**`);
    lines.push(...noImage.map((f) => `• @${f.username} — ${f.url}`));
  }
  if (noLocation.length) {
    if (lines.length) lines.push('');
    lines.push(`**📍 No location found (${noLocation.length}):**`);
    for (const f of noLocation) {
      lines.push(`• @${f.username} — ${f.url}`);
      if (verbosity === 'debug' && f.debugInfo?.length) {
        lines.push(...f.debugInfo.map((d) => `  > ${d}`));
      }
    }
    lines.push('');
    lines.push('_Tip: edit the message to include a location like `Spring, Texas` then re-run `/munchhat-import`._');
  }

  const chunks = chunkLines('⚠️ **Messages that could not be mapped:**\n', lines);
  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk, ephemeral: false });
  }
}
