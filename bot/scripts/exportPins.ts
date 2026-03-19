/**
 * exportPins.ts — weekly backup script.
 *
 * Reads all pins from Cosmos DB and writes a timestamped JSON file
 * to the cosmos-backups blob container in Azure Blob Storage.
 *
 * Usage (from repo root):
 *   COSMOS_DB_ENDPOINT=... COSMOS_DB_KEY=... \
 *   AZURE_STORAGE_ACCOUNT_NAME=... AZURE_STORAGE_KEY=... \
 *   npx tsx bot/scripts/exportPins.ts
 *
 * Auth fallback: if COSMOS_DB_KEY is omitted, DefaultAzureCredential is used
 * (managed identity in production, az login locally).
 * If AZURE_STORAGE_KEY is omitted, DefaultAzureCredential is used for blob auth.
 */

import { CosmosClient } from '@azure/cosmos';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { MapPin } from '../src/types/mapPin.js';

const COSMOS_ENDPOINT  = process.env.COSMOS_DB_ENDPOINT ?? '';
const COSMOS_KEY       = process.env.COSMOS_DB_KEY ?? '';
const ACCOUNT_NAME     = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '';
const STORAGE_KEY      = process.env.AZURE_STORAGE_KEY ?? '';
const BACKUP_CONTAINER = process.env.BACKUP_CONTAINER ?? 'cosmos-backups';
const DB_NAME          = 'munchhatmap';
const PINS_CONTAINER   = 'pins';

if (!COSMOS_ENDPOINT || !ACCOUNT_NAME) {
  console.error('Missing required env vars: COSMOS_DB_ENDPOINT, AZURE_STORAGE_ACCOUNT_NAME');
  process.exit(1);
}

async function main(): Promise<void> {
  // Cosmos client — key or managed identity
  const cosmos = COSMOS_KEY
    ? new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY })
    : new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });

  const container = cosmos.database(DB_NAME).container(PINS_CONTAINER);

  console.log('Reading all pins from Cosmos DB…');
  const { resources: pins } = await container.items
    .query<MapPin>({ query: 'SELECT * FROM c' })
    .fetchAll();
  console.log(`  Found ${pins.length} pins.`);

  // Blob client — storage key or managed identity
  const blobServiceClient = STORAGE_KEY
    ? new BlobServiceClient(
        `https://${ACCOUNT_NAME}.blob.core.windows.net`,
        new StorageSharedKeyCredential(ACCOUNT_NAME, STORAGE_KEY),
      )
    : new BlobServiceClient(
        `https://${ACCOUNT_NAME}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );

  const containerClient = blobServiceClient.getContainerClient(BACKUP_CONTAINER);
  await containerClient.createIfNotExists();

  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const blobName = `pins-backup-${date}.json`;
  const blockBlob = containerClient.getBlockBlobClient(blobName);

  const json = JSON.stringify(pins, null, 2);
  await blockBlob.uploadData(Buffer.from(json), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  console.log(`Backup written: ${BACKUP_CONTAINER}/${blobName} (${pins.length} pins, ${json.length} bytes)`);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
