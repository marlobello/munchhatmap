/**
 * batchScan.ts — scans a TextChannel (and its "Munch Map" thread) for images to pin.
 */

import {
  TextChannel,
  ThreadChannel,
  Collection,
  Message,
  Snowflake,
} from 'discord.js';
import { savePin, pinExistsByMessageId } from '../db.js';
import { processMessageIntoPin } from '../pinProcessor.js';
import type { FailedMessage, ScanResult, Verbosity } from './types.js';

const DISCORD_MSG_BASE = 'https://discord.com/channels';
const MUNCH_MAP_THREAD = 'munch map';

export interface BatchScanResult extends ScanResult {
  threadScanned: boolean;
}

export interface ScanOptions {
  cutoffDate: Date | null;
  filterUserId: string | null;
  verbosity: Verbosity;
}

/**
 * Scans a single TextChannel or ThreadChannel for messages to pin.
 * `skipTagCheck=true` means all images are candidates (used for Munch Map thread).
 */
async function scanSource(
  source: TextChannel | ThreadChannel,
  skipTagCheck: boolean,
  options: ScanOptions,
  result: ScanResult,
): Promise<void> {
  const { cutoffDate, filterUserId, verbosity } = options;
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
      result.totalScanned++;
      if (filterUserId && message.author.id !== filterUserId) continue;

      const alreadyExists = await pinExistsByMessageId(message.id, message.guildId!);
      if (alreadyExists) { result.duplicates++; continue; }

      const debugInfo: string[] = [];
      const processingResult = await processMessageIntoPin(message, {
        skipTagCheck,
        debugLog: verbosity === 'debug' ? debugInfo : undefined,
      });

      if (processingResult === 'no_tag') continue;

      const msgUrl = `${DISCORD_MSG_BASE}/${message.guildId}/${message.channelId}/${message.id}`;

      if (processingResult === 'no_image') {
        if (!skipTagCheck) {
          result.failed.push({ url: msgUrl, reason: 'no_image', username: message.author.username });
        }
        continue;
      }
      if (processingResult === 'no_location') {
        result.failed.push({
          url: msgUrl,
          reason: 'no_location',
          username: message.author.username,
          debugInfo: debugInfo.length ? debugInfo : undefined,
        });
        continue;
      }
      try {
        await savePin(processingResult);
        result.imported++;
      } catch (err) {
        console.error(`[import] Failed to save pin for message ${message.id}:`, err);
      }
    }

    if (hitCutoff) break;
    lastMessageId = batch.last()?.id;
    if (batch.size < 100) break;
  }
}

/**
 * Scans a channel and its "Munch Map" thread (if it exists).
 * Returns a combined ScanResult plus whether a thread was found and scanned.
 */
export async function handleBatchScan(
  scanChannel: TextChannel,
  options: ScanOptions,
): Promise<BatchScanResult> {
  const result: ScanResult = { imported: 0, duplicates: 0, totalScanned: 0, failed: [] };

  await scanSource(scanChannel, false, options, result);

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
      await scanSource(munchMapThread, true, options, result);
    } else {
      console.log(`[import] No thread named "${MUNCH_MAP_THREAD}" found in #${scanChannel.name}`);
    }
  } catch (err) {
    console.error('[import] Failed to fetch threads:', err);
  }

  console.log(
    `[import] Done. scanned=${result.totalScanned} imported=${result.imported} duplicates=${result.duplicates} ` +
    `failed=${result.failed.length} threadScanned=${threadScanned}`,
  );

  return { ...result, threadScanned };
}
