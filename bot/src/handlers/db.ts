import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { MapPin } from '../types/mapPin.js';

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

// Singleton client — uses managed identity (no key needed).
// Falls back to key-based auth for local development if COSMOS_DB_KEY is set.
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

export async function savePin(pin: MapPin): Promise<void> {
  const client = getClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);
  await container.items.create(pin);
}

/** Upserts a pin — creates if new, replaces in-place if the id already exists. */
export async function upsertPin(pin: MapPin): Promise<void> {
  const client = getClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);
  await container.items.upsert(pin);
}

/** Returns the full existing pin for a message, or null if not found. */
export async function getPinByMessageId(messageId: string, guildId: string): Promise<MapPin | null> {
  const client = getClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);
  const { resources } = await container.items
    .query<MapPin>({
      query: 'SELECT * FROM c WHERE c.messageId = @messageId AND c.guildId = @guildId',
      parameters: [
        { name: '@messageId', value: messageId },
        { name: '@guildId', value: guildId },
      ],
    })
    .fetchAll();
  return resources[0] ?? null;
}

export async function pinExistsByMessageId(messageId: string, guildId: string): Promise<boolean> {
  const client = getClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);
  const { resources } = await container.items
    .query<{ id: string }>({
      query: 'SELECT c.id FROM c WHERE c.messageId = @messageId AND c.guildId = @guildId',
      parameters: [
        { name: '@messageId', value: messageId },
        { name: '@guildId', value: guildId },
      ],
    })
    .fetchAll();
  return resources.length > 0;
}
