/**
 * validation.ts — permission checks, cooldown enforcement, option mutual-exclusivity
 * validation, and lookback string parsing for the munchhat-import command.
 */

import { ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
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
 * Validates command options for single-message import mode.
 * Returns an error message string if validation fails, or null if all options are valid.
 *
 * DISABLED: lookback and channel mutual-exclusivity checks (batch scanning is disabled).
 * Restore the full signature and checks when re-enabling batch scan.
 */
export function validateOptions(
  messageUrl: string | null,
  forceLocation: string | null,
  force: boolean,
): string | null {
  if (!messageUrl)
    return '❌ `message` parameter is required.';
  if (forceLocation && force)
    return '❌ `force` and `force-location` cannot be used together. Use `force` to re-run geocoding, or `force-location` to override it with a specific place.';
  return null;
}

// DISABLED: parseLookback — only needed for batch scanning.
// export function parseLookback(value: string): Date | null { ... }

// DISABLED: resolveScanChannel — only needed for batch scanning.
// export function resolveScanChannel(...): TextChannel | string { ... }
