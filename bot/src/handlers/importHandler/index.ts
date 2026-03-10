/**
 * index.ts — thin dispatcher for the munchhat-import command.
 * Orchestrates validation, routing to single-message or batch scan, and reporting.
 */

import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import {
  checkPermissions,
  checkCooldown,
  validateOptions,
  parseLookback,
  resolveScanChannel,
} from './validation.js';
import { handleSingleMessage } from './singleMessage.js';
import { handleBatchScan } from './batchScan.js';
import { sendSummary, sendFailureReport } from './reporting.js';
import type { Verbosity } from './types.js';

export { Verbosity };
export type { FailedMessage, ScanResult } from './types.js';

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
  const { elevated, filterUserId } = checkPermissions(interaction);

  const verbosity = (interaction.options.getString('verbosity') ?? 'standard') as Verbosity;
  const lookbackStr = interaction.options.getString('lookback');
  const messageUrl = interaction.options.getString('message');
  const targetChannelOption = interaction.options.getChannel('channel');
  const forceLocation = interaction.options.getString('force-location');
  const force = interaction.options.getBoolean('force') ?? false;

  const validationError = validateOptions(messageUrl, lookbackStr, targetChannelOption, forceLocation, force);
  if (validationError) {
    await interaction.reply({ content: validationError, ephemeral: true });
    return;
  }

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

  const scanChannelResult = resolveScanChannel(interaction, targetChannelOption as import('discord.js').GuildBasedChannel | null);
  if (typeof scanChannelResult === 'string') {
    await interaction.reply({ content: scanChannelResult, ephemeral: true });
    return;
  }
  const scanChannel = scanChannelResult;

  const cooldownMs = checkCooldown(interaction.user.id, scanChannel.id, elevated);
  if (cooldownMs > 0) {
    const mins = Math.ceil(cooldownMs / 60000);
    await interaction.reply({
      content: `⏳ Please wait ${mins} more minute${mins !== 1 ? 's' : ''} before running the import again.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  if (messageUrl) {
    await handleSingleMessage(interaction, messageUrl, forceLocation, force, verbosity);
    return;
  }

  const scopeNote = elevated ? 'all messages' : 'your messages only';
  const result = await handleBatchScan(scanChannel, { cutoffDate, filterUserId, verbosity });

  await sendSummary(interaction, {
    ...result,
    scopeNote,
    scanChannel,
    targetChannelOption: targetChannelOption as import('discord.js').GuildBasedChannel | null,
    lookbackStr,
    cutoffDate,
  });

  await sendFailureReport(interaction, result.failed, verbosity);
}
