/**
 * storage.ts — uploads Discord attachment images to Azure Blob Storage.
 *
 * Uses DefaultAzureCredential (managed identity in production, az login locally).
 * If AZURE_STORAGE_ACCOUNT_NAME is not set, returns the original Discord URL unchanged
 * so local development works without Azure storage configured.
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { extname } from 'path';

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const CONTAINER_NAME = process.env.IMAGE_STORAGE_CONTAINER ?? 'pin-images';

let _blobClient: BlobServiceClient | null = null;

function getBlobClient(): BlobServiceClient | null {
  if (!ACCOUNT_NAME) return null;
  if (!_blobClient) {
    const url = `https://${ACCOUNT_NAME}.blob.core.windows.net`;
    _blobClient = new BlobServiceClient(url, new DefaultAzureCredential());
  }
  return _blobClient;
}

/**
 * Returns the file extension from a URL path (e.g. ".jpg"), defaulting to ".jpg".
 */
function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).toLowerCase().split('?')[0];
    return ext || '.jpg';
  } catch {
    return '.jpg';
  }
}

/**
 * Downloads an image from Discord and uploads it to Azure Blob Storage.
 * Returns the permanent base blob URL (no SAS params).
 *
 * Falls back to the original Discord CDN URL if:
 *   - AZURE_STORAGE_ACCOUNT_NAME is not configured (local dev)
 *   - Any download/upload error occurs
 */
export async function uploadImageToBlob(
  discordUrl: string,
  messageId: string,
  contentType: string,
): Promise<string> {
  const client = getBlobClient();
  if (!client) {
    return discordUrl; // local dev — no storage configured
  }

  const ext = extensionFromUrl(discordUrl);
  const blobName = `${messageId}${ext}`;

  try {
    const response = await fetch(discordUrl);
    if (!response.ok) {
      console.warn(`[storage] Failed to fetch image (${response.status}): ${discordUrl}`);
      return discordUrl;
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const containerClient = client.getContainerClient(CONTAINER_NAME);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType || 'image/jpeg' },
    });

    return blockBlob.url; // permanent base URL — no SAS params
  } catch (err) {
    console.error('[storage] Upload failed, using Discord URL:', err instanceof Error ? err.message : err);
    return discordUrl;
  }
}
