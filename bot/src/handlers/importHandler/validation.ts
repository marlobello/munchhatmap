/**
 * validation.ts — permission checks, cooldown enforcement, option mutual-exclusivity
 * validation, and lookback string parsing for the munchhat-import command.
 */

import { ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from 'discord.js';
import type { Verbosity } from './types.js';

const IMPORT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per user per channel

/** userId:channelId → last import timestamp */
const lastImportTime = new Map<string, number>();

export interface ParsedOptions {
  verbosity: Verbosity;
  lookbackStr: string | null;
  messageUrl: string | null;
  targetChannelOption: import('discord.js').GuildBasedChannel | null;
  forceLocation: string | null;
  force: boolean;
  elevated: boolean;
  filterUserId: string | null;
}

/**
 * Checks whether the invoking member has elevated permissions (Manage Server or Mod role).
 * Returns { elevated, filterUserId } — non-elevated users are filtered to their own messages.
 */
export function checkPermissions(interaction: ChatInputCommandInteraction): { elevated: boolean; filterUserId: string | null } {
  const hasManageServer = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  const modRole = interaction.guild?.roles.cache.find((r) => r.name.toLowerCase() === 'mod');
  const memberHasModRole =
    modRole &&
    (interaction.member?.roles as { cache: { has: (id: string) => boolean } })?.cache?.has(modRole.id);
  const elevated = hasManageServer || !!memberHasModRole;
  return { elevated, filterUserId: elevated ? null : interaction.user.id };
}

/**
 * Enforces per-user per-channel rate limiting. Elevated users are exempt.
 * Returns the remaining cooldown in ms, or 0 if clear to proceed.
 */
export function checkCooldown(userId: string, channelId: string, elevated: boolean): number {
  if (elevated) return 0;
  const key = `${userId}:${channelId}`;
  const lastRun = lastImportTime.get(key) ?? 0;
  const remaining = IMPORT_COOLDOWN_MS - (Date.now() - lastRun);
  if (remaining > 0) return remaining;
  lastImportTime.set(key, Date.now());
  return 0;
}

/**
 * Validates mutual exclusivity of command options.
 * Returns an error message string if validation fails, or null if all options are valid.
 */
export function validateOptions(
  messageUrl: string | null,
  lookbackStr: string | null,
  targetChannel: unknown,
  forceLocation: string | null,
  force: boolean,
): string | null {
  if (forceLocation && !messageUrl)
    return '❌ `force-location` can only be used together with the `message` parameter.';
  if (force && forceLocation)
    return '❌ `force` and `force-location` cannot be used together. Use `force` to re-run geocoding, or `force-location` to override it with a specific place.';
  if (force && !messageUrl)
    return '❌ `force` can only be used together with the `message` parameter.';
  if (messageUrl && lookbackStr)
    return '❌ `message` and `lookback` cannot be used together. Use `message` to target a specific post, or `lookback` to scan a time range.';
  if (messageUrl && targetChannel)
    return '❌ `message` and `channel` cannot be used together. The target channel is determined from the message link itself.';
  return null;
}

/**
 * Parses a lookback string like "7d", "2w", "3M", "1y" into a cutoff Date.
 * Returns null if the string is invalid.
 * Units: m=minutes, h=hours, d=days, w=weeks, M=months, y=years
 */
export function parseLookback(value: string): Date | null {
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

/**
 * Resolves and validates the scan channel from the interaction.
 * Returns the TextChannel to scan, or an error string.
 */
export function resolveScanChannel(
  interaction: ChatInputCommandInteraction,
  targetChannelOption: import('discord.js').GuildBasedChannel | null,
): TextChannel | string {
  const replyChannel = interaction.channel;
  if (!replyChannel || !(replyChannel instanceof TextChannel)) {
    return '❌ This command must be used in a text channel.';
  }
  if (!targetChannelOption) return replyChannel;
  if (!(targetChannelOption instanceof TextChannel)) {
    return '❌ Target channel must be a text channel.';
  }
  return targetChannelOption;
}
