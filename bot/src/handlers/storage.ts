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

// Only fetch images from Discord CDN — prevents SSRF via crafted message attachments.
const ALLOWED_IMAGE_HOSTS = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

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

export interface BlobUploadResult {
  url: string;
  /** Set when upload failed — contains the error reason for debug logging. */
  error?: string;
}

/**
 * Downloads a Discord image and uploads it to Azure Blob Storage.
 * Returns the permanent blob URL on success, or the original Discord URL with an error reason on failure.
 */
export async function uploadImageToBlob(
  discordUrl: string,
  messageId: string,
  contentType: string,
): Promise<BlobUploadResult> {
  const client = getBlobClient();
  if (!client) {
    return { url: discordUrl }; // local dev — no storage configured
  }

  if (!ALLOWED_IMAGE_HOSTS.test(discordUrl)) {
    const error = `Blocked fetch from non-Discord URL: ${discordUrl}`;
    console.warn(`[storage] ${error}`);
    return { url: discordUrl, error };
  }

  const ext = extensionFromUrl(discordUrl);
  const blobName = `${messageId}${ext}`;

  try {
    const response = await fetch(discordUrl);
    if (!response.ok) {
      const error = `Image download failed: HTTP ${response.status} ${response.statusText}`;
      console.warn(`[storage] ${error}: ${discordUrl}`);
      return { url: discordUrl, error };
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const containerClient = client.getContainerClient(CONTAINER_NAME);
    const blockBlob = containerClient.getBlockBlobClient(blobName);

    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType || 'image/jpeg' },
    });

    return { url: blockBlob.url }; // permanent base URL — no SAS params
  } catch (err) {
    const error = `Upload error: ${err instanceof Error ? err.message : String(err)}`;
    console.error('[storage] Upload failed, using Discord URL:', error);
    return { url: discordUrl, error };
  }
}
