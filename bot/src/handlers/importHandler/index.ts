/**
 * index.ts — thin dispatcher for the munchhat-import command.
 * Orchestrates validation, routing to single-message import, and reporting.
 *
 * NOTE: Bulk channel scanning (lookback, channel sweep) is intentionally disabled.
 * The message parameter is now required. To re-enable batch scanning, restore the
 * commented-out imports and batch dispatch block below, and re-add the lookback/channel
 * options to the slash command definition in bot/src/index.ts.
 */

import { ChatInputCommandInteraction } from 'discord.js';
import {
  checkPermissions,
  checkCooldown,
  validateOptions,
  // DISABLED: parseLookback,
  // DISABLED: resolveScanChannel,
} from './validation.js';
import { handleSingleMessage } from './singleMessage.js';
// DISABLED: import { handleBatchScan } from './batchScan.js';
// DISABLED: import { sendSummary, sendFailureReport } from './reporting.js';
import type { Verbosity } from './types.js';

export { Verbosity };
export type { FailedMessage, ScanResult } from './types.js';

export async function handleImport(interaction: ChatInputCommandInteraction): Promise<void> {
  const { elevated, filterUserId: _filterUserId } = checkPermissions(interaction);

  const verbosity = (interaction.options.getString('verbosity') ?? 'standard') as Verbosity;
  const messageUrl = interaction.options.getString('message');
  const forceLocation = interaction.options.getString('force-location');
  const force = interaction.options.getBoolean('force') ?? false;

  // DISABLED: lookback and channel options — bulk scanning is disabled
  // const lookbackStr = interaction.options.getString('lookback');
  // const targetChannelOption = interaction.options.getChannel('channel');

  const validationError = validateOptions(messageUrl, forceLocation, force);
  if (validationError) {
    await interaction.reply({ content: validationError, ephemeral: true });
    return;
  }

  // DISABLED: lookback parsing
  // DISABLED: resolveScanChannel
  // DISABLED: checkCooldown (only relevant for batch scans; single message imports are fast)

  // Cooldown still applies for non-elevated users even on single imports
  const scanChannelId = interaction.channelId ?? 'unknown';
  const cooldownMs = checkCooldown(interaction.user.id, scanChannelId, elevated);
  if (cooldownMs > 0) {
    const mins = Math.ceil(cooldownMs / 60000);
    await interaction.reply({
      content: `⏳ Please wait ${mins} more minute${mins !== 1 ? 's' : ''} before running the import again.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  await handleSingleMessage(interaction, messageUrl!, forceLocation, force, verbosity);

  // DISABLED: batch scan dispatch
  // const scopeNote = elevated ? 'all messages' : 'your messages only';
  // const result = await handleBatchScan(scanChannel, { cutoffDate, filterUserId, verbosity });
  // await sendSummary(interaction, { ...result, scopeNote, scanChannel, targetChannelOption, lookbackStr, cutoffDate });
  // await sendFailureReport(interaction, result.failed, verbosity);
}
