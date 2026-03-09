/**
 * blobSas.ts — generates User Delegation SAS URLs for private Azure Blob Storage images.
 *
 * Uses DefaultAzureCredential (API managed identity) with Storage Blob Delegator role.
 * The delegation key is cached for its full validity period to minimise API calls.
 *
 * If AZURE_STORAGE_ACCOUNT_NAME is not configured, blob URLs are returned unchanged.
 */

import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  UserDelegationKey,
  SASProtocol,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '';
const CONTAINER_NAME = process.env.IMAGE_STORAGE_CONTAINER ?? 'pin-images';
const SAS_TTL_HOURS = 7 * 24; // 7 days — refreshed every time getPins is called

let _blobClient: BlobServiceClient | null = null;

interface CachedDelegationKey {
  key: UserDelegationKey;
  expiresOn: Date;
}
let _delegationKey: CachedDelegationKey | null = null;

function getBlobClient(): BlobServiceClient | null {
  if (!ACCOUNT_NAME) return null;
  if (!_blobClient) {
    _blobClient = new BlobServiceClient(
      `https://${ACCOUNT_NAME}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  return _blobClient;
}

/** Returns true if the URL points to our private blob container. */
function isBlobUrl(url: string): boolean {
  return ACCOUNT_NAME.length > 0 && url.includes(`${ACCOUNT_NAME}.blob.core.windows.net`);
}

/**
 * Returns a cached User Delegation Key, refreshing if it expires within 1 hour.
 */
async function getDelegationKey(client: BlobServiceClient): Promise<UserDelegationKey> {
  const now = new Date();
  const refreshThreshold = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour buffer

  if (_delegationKey && _delegationKey.expiresOn > refreshThreshold) {
    return _delegationKey.key;
  }

  const startsOn = new Date(now.getTime() - 60 * 1000); // 1 min in past to handle clock skew
  const expiresOn = new Date(now.getTime() + SAS_TTL_HOURS * 60 * 60 * 1000);

  const key = await client.getUserDelegationKey(startsOn, expiresOn);
  _delegationKey = { key, expiresOn };
  return key;
}

/**
 * Generates a User Delegation SAS URL for a blob.
 * Takes the base blob URL and returns a URL with SAS query params appended.
 * Falls back to the original URL on any error.
 */
export async function generateSasUrl(blobUrl: string): Promise<string> {
  if (!isBlobUrl(blobUrl)) return blobUrl;

  const client = getBlobClient();
  if (!client) return blobUrl;

  try {
    const url = new URL(blobUrl);
    const blobName = url.pathname.replace(`/${CONTAINER_NAME}/`, '');

    const delegationKey = await getDelegationKey(client);
    // Cap SAS expiry at the delegation key's own expiry — Azure rejects tokens that outlive their key.
    const expiresOn = new Date(Math.min(
      Date.now() + SAS_TTL_HOURS * 60 * 60 * 1000,
      delegationKey.signedExpiresOn.getTime(),
    ));

    const sasParams = generateBlobSASQueryParameters(
      {
        containerName: CONTAINER_NAME,
        blobName,
        permissions: BlobSASPermissions.parse('r'), // read-only
        expiresOn,
        protocol: SASProtocol.Https,
      },
      delegationKey,
      ACCOUNT_NAME,
    );

    return `${blobUrl}?${sasParams.toString()}`;
  } catch (err) {
    console.error('[blobSas] Failed to generate SAS URL:', err instanceof Error ? err.message : err);
    return blobUrl;
  }
}
