/**
 * importPins.ts — recovery script.
 *
 * Reads a backup JSON file (from blob storage or a local file) and upserts
 * every pin back into Cosmos DB. Safe to run against a live database — upsert
 * preserves pins not in the backup and overwrites only matching IDs.
 *
 * Usage:
 *   # Restore from blob (used by the backup.yml workflow_dispatch)
 *   COSMOS_DB_ENDPOINT=... COSMOS_DB_KEY=... \
 *   AZURE_STORAGE_ACCOUNT_NAME=... AZURE_STORAGE_KEY=... \
 *   BACKUP_BLOB=pins-backup-2026-03-16.json \
 *   npx tsx bot/scripts/importPins.ts
 *
 *   # Restore from local file
 *   COSMOS_DB_ENDPOINT=... COSMOS_DB_KEY=... \
 *   BACKUP_FILE=/path/to/pins-backup.json \
 *   npx tsx bot/scripts/importPins.ts
 *
 * Auth fallback: if COSMOS_DB_KEY is omitted, DefaultAzureCredential is used.
 * If AZURE_STORAGE_KEY is omitted, DefaultAzureCredential is used for blob auth.
 */

import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { readFile } from 'fs/promises';
import type { MapPin } from '../src/types/mapPin.js';

const COSMOS_ENDPOINT  = process.env.COSMOS_DB_ENDPOINT ?? '';
const COSMOS_KEY       = process.env.COSMOS_DB_KEY ?? '';
const ACCOUNT_NAME     = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '';
const STORAGE_KEY      = process.env.AZURE_STORAGE_KEY ?? '';
const BACKUP_CONTAINER = process.env.BACKUP_CONTAINER ?? 'cosmos-backups';
const BACKUP_BLOB      = process.env.BACKUP_BLOB ?? '';    // blob name in storage
const BACKUP_FILE      = process.env.BACKUP_FILE ?? '';    // local file path
const DB_NAME          = 'munchhatmap';
const PINS_CONTAINER   = 'pins';

if (!COSMOS_ENDPOINT) {
  console.error('Missing required env var: COSMOS_DB_ENDPOINT');
  process.exit(1);
}
if (!BACKUP_BLOB && !BACKUP_FILE) {
  console.error('Provide either BACKUP_BLOB (blob name in storage) or BACKUP_FILE (local path)');
  process.exit(1);
}

async function loadPins(): Promise<MapPin[]> {
  if (BACKUP_FILE) {
    console.log(`Reading pins from local file: ${BACKUP_FILE}`);
    const raw = await readFile(BACKUP_FILE, 'utf-8');
    return JSON.parse(raw) as MapPin[];
  }

  if (!ACCOUNT_NAME) {
    console.error('Missing AZURE_STORAGE_ACCOUNT_NAME (required when using BACKUP_BLOB)');
    process.exit(1);
  }

  console.log(`Downloading backup from blob: ${BACKUP_CONTAINER}/${BACKUP_BLOB}`);
  const blobServiceClient = STORAGE_KEY
    ? new BlobServiceClient(
        `https://${ACCOUNT_NAME}.blob.core.windows.net`,
        new StorageSharedKeyCredential(ACCOUNT_NAME, STORAGE_KEY),
      )
    : new BlobServiceClient(
        `https://${ACCOUNT_NAME}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );

  const blockBlob = blobServiceClient
    .getContainerClient(BACKUP_CONTAINER)
    .getBlockBlobClient(BACKUP_BLOB);

  const download = await blockBlob.downloadToBuffer();
  return JSON.parse(download.toString('utf-8')) as MapPin[];
}

async function main(): Promise<void> {
  const pins = await loadPins();
  console.log(`  Loaded ${pins.length} pins from backup.`);

  const cosmos = COSMOS_KEY
    ? new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY })
    : new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });

  const container = cosmos.database(DB_NAME).container(PINS_CONTAINER);

  console.log('Upserting pins into Cosmos DB…');
  let success = 0;
  let failed = 0;

  for (const pin of pins) {
    try {
      await container.items.upsert(pin);
      success++;
      if (success % 50 === 0) console.log(`  … ${success}/${pins.length}`);
    } catch (err) {
      console.warn(`  FAIL [${pin.id}]:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`\nDone. Restored: ${success}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
