/**
 * migrateImageUrls.ts — one-time migration script.
 *
 * For every pin in Cosmos DB that still has a Discord CDN imageUrl,
 * this script:
 *   1. Fetches the original Discord message via the REST API to get a
 *      fresh (non-expired) attachment URL.
 *   2. Downloads the image.
 *   3. Uploads it to Azure Blob Storage.
 *   4. Upserts the pin in Cosmos DB with the permanent blob URL.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=... \
 *   COSMOS_DB_ENDPOINT=... \
 *   COSMOS_DB_KEY=... \
 *   AZURE_STORAGE_ACCOUNT_NAME=... \
 *   IMAGE_STORAGE_CONTAINER=pin-images \
 *   node --loader tsx bot/scripts/migrateImageUrls.ts
 *
 * Or with tsx directly from the bot directory:
 *   cd bot && npx tsx scripts/migrateImageUrls.ts
 *
 * Safe to re-run: already-migrated pins (blob URL) are skipped.
 * Does NOT delete any data; only updates the imageUrl field.
 */

import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { extname } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const COSMOS_ENDPOINT    = process.env.COSMOS_DB_ENDPOINT ?? '';
const COSMOS_KEY         = process.env.COSMOS_DB_KEY ?? '';
const ACCOUNT_NAME       = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '';
const CONTAINER_NAME     = process.env.IMAGE_STORAGE_CONTAINER ?? 'pin-images';
const DB_NAME            = 'munchhatmap';
const PINS_CONTAINER     = 'pins';

if (!DISCORD_BOT_TOKEN || !COSMOS_ENDPOINT || !COSMOS_KEY || !ACCOUNT_NAME) {
  console.error('Missing required environment variables. See script header for usage.');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDiscordUrl(url: string): boolean {
  return url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net');
}

function extensionFromUrl(url: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase().split('?')[0];
    return ext || '.jpg';
  } catch {
    return '.jpg';
  }
}

async function fetchFreshDiscordUrl(channelId: string, messageId: string): Promise<string | null> {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null; // message deleted
      console.warn(`  Discord API ${res.status} for message ${messageId}`);
      return null;
    }
    const data = await res.json() as { attachments?: { url: string }[] };
    return data.attachments?.[0]?.url ?? null;
  } catch (err) {
    console.warn(`  Failed to fetch message ${messageId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function uploadToBlob(
  blobClient: BlobServiceClient,
  imageUrl: string,
  messageId: string,
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`  Failed to download image (${res.status}): ${imageUrl.slice(0, 80)}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = extensionFromUrl(imageUrl);
    const blobName = `${messageId}${ext}`;

    const container = blobClient.getContainerClient(CONTAINER_NAME);
    const blockBlob = container.getBlockBlobClient(blobName);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return blockBlob.url;
  } catch (err) {
    console.warn(`  Upload failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cosmos = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  const container = cosmos.database(DB_NAME).container(PINS_CONTAINER);

  const blobClient = new BlobServiceClient(
    `https://${ACCOUNT_NAME}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );

  // Ensure the container exists
  await blobClient.getContainerClient(CONTAINER_NAME).createIfNotExists();

  const { resources: allPins } = await container.items
    .query({ query: 'SELECT * FROM c' })
    .fetchAll();

  const toMigrate = allPins.filter((p: Record<string, unknown>) => isDiscordUrl(String(p.imageUrl ?? '')));

  console.log(`Found ${allPins.length} total pins, ${toMigrate.length} need migration.`);
  if (toMigrate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const pin of toMigrate) {
    const p = pin as { id: string; channelId: string; messageId: string; guildId: string; imageUrl: string };
    process.stdout.write(`  [${success + skipped + failed + 1}/${toMigrate.length}] ${p.messageId} … `);

    // Get a fresh URL from Discord (stored URL may be expired)
    const freshUrl = await fetchFreshDiscordUrl(p.channelId, p.messageId);
    if (!freshUrl) {
      console.log('SKIP — message not found or no attachment');
      skipped++;
      continue;
    }

    const blobUrl = await uploadToBlob(blobClient, freshUrl, p.messageId);
    if (!blobUrl) {
      console.log('FAIL — upload error');
      failed++;
      continue;
    }

    // Upsert pin with new blob URL
    await container.items.upsert({ ...p, imageUrl: blobUrl });
    console.log(`OK → ${blobUrl.split('/').pop()}`);
    success++;

    // Brief pause to avoid Discord rate limits (50 req/s)
    await new Promise((r) => setTimeout(r, 25));
  }

  console.log(`\nDone. Migrated: ${success}  Skipped (deleted): ${skipped}  Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
