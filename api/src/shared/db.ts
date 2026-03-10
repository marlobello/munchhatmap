import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { MapPin } from './types.js';

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

let _client: CosmosClient | null = null;

export function getCosmosClient(): CosmosClient {
  if (_client) return _client;
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  if (!endpoint) throw new Error('COSMOS_DB_ENDPOINT environment variable is required');
  const key = process.env.COSMOS_DB_KEY;
  _client = key
    ? new CosmosClient({ endpoint, key }) // local dev fallback
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  return _client;
}

/**
 * Returns all pins, optionally filtered by guildId, channelId, or userId.
 * Additional query params are accepted but ignored for now (designed for Phase 2 filtering).
 */
export async function getPins(filters: {
  guildId?: string;
  channelId?: string;
  userId?: string;
}): Promise<MapPin[]> {
  const client = getCosmosClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);

  const conditions: string[] = [];
  const parameters: { name: string; value: string }[] = [];

  if (filters.guildId) {
    conditions.push('c.guildId = @guildId');
    parameters.push({ name: '@guildId', value: filters.guildId });
  }
  if (filters.channelId) {
    conditions.push('c.channelId = @channelId');
    parameters.push({ name: '@channelId', value: filters.channelId });
  }
  if (filters.userId) {
    conditions.push('c.userId = @userId');
    parameters.push({ name: '@userId', value: filters.userId });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const querySpec = {
    query: `SELECT * FROM c ${where} ORDER BY c.createdAt DESC`,
    parameters,
  };

  const { resources } = await container.items.query<MapPin>(querySpec).fetchAll();
  return resources;
}

/**
 * Fetches a single pin by its Cosmos document ID and partition key (guildId).
 * Uses a point read — the most efficient Cosmos DB operation.
 * Returns null if the pin does not exist.
 */
export async function getPinById(id: string, guildId: string): Promise<MapPin | null> {
  const container = getCosmosClient().database(DB_NAME).container(CONTAINER_NAME);
  try {
    const { resource } = await container.item(id, guildId).read<MapPin>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/**
 * Upserts a pin document. Creates if the ID doesn't exist, replaces if it does.
 */
export async function upsertPin(pin: MapPin): Promise<void> {
  const container = getCosmosClient().database(DB_NAME).container(CONTAINER_NAME);
  await container.items.upsert(pin);
}

/**
 * Deletes a pin document by id and partition key (guildId).
 */
export async function deletePin(id: string, guildId: string): Promise<void> {
  const container = getCosmosClient().database(DB_NAME).container(CONTAINER_NAME);
  await container.item(id, guildId).delete();
}
