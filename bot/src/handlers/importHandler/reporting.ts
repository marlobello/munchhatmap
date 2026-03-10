/**
 * reporting.ts — summary reply and failure report for the batch import command.
 */

import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { FailedMessage, Verbosity } from './types.js';

const MAP_URL = process.env.MAP_URL ?? '';

export interface SummaryOptions {
  imported: number;
  duplicates: number;
  totalScanned: number;
  failed: FailedMessage[];
  scopeNote: string;
  threadScanned: boolean;
  scanChannel: TextChannel;
  targetChannelOption: import('discord.js').GuildBasedChannel | null;
  lookbackStr: string | null;
  cutoffDate: Date | null;
}

/** Splits a header + lines into chunks that fit within Discord's 2000-char limit. */
export function chunkLines(header: string, lines: string[], maxLen = 1950): string[] {
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

/** Sends the batch import summary reply. */
export async function sendSummary(
  interaction: ChatInputCommandInteraction,
  opts: SummaryOptions,
): Promise<void> {
  const { imported, duplicates, totalScanned, failed, scopeNote, threadScanned, scanChannel, targetChannelOption, lookbackStr, cutoffDate } = opts;
  const mapLink = MAP_URL ? `\n🗺️ [View the map](${MAP_URL})` : '';
  const threadNote = threadScanned ? '\n🧵 Also scanned **Munch Map** thread' : '';
  const channelNote = targetChannelOption ? `\n📂 Scanned: <#${scanChannel.id}>` : '';
  const lookbackNote = cutoffDate
    ? `\n🕐 Lookback: \`${lookbackStr}\` (since <t:${Math.floor(cutoffDate.getTime() / 1000)}:f>)`
    : '';

  await interaction.editReply(
    `✅ **Import complete** (${scopeNote})` +
    channelNote + lookbackNote +
    `\n📊 Scanned ${totalScanned} messages\n` +
    `📍 Imported: **${imported}** new pin${imported !== 1 ? 's' : ''}\n` +
    `⏭️ Already mapped: **${duplicates}**\n` +
    `⚠️ Needs attention: **${failed.length}**` +
    threadNote + mapLink,
  );
}

/** Sends a chunked failure report as follow-up(s). Skipped at standard verbosity. */
export async function sendFailureReport(
  interaction: ChatInputCommandInteraction,
  failed: FailedMessage[],
  verbosity: Verbosity,
): Promise<void> {
  if (verbosity === 'standard' || failed.length === 0) return;

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
