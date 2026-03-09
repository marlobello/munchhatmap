import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { MapPin } from './types.js';

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

let _client: CosmosClient | null = null;

function getClient(): CosmosClient {
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
  const client = getClient();
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
