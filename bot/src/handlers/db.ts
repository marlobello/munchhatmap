import { CosmosClient } from '@azure/cosmos';
import type { MapPin } from '../types/mapPin.js';

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

function getClient(): CosmosClient {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;
  if (!endpoint || !key) {
    throw new Error('COSMOS_DB_ENDPOINT and COSMOS_DB_KEY environment variables are required');
  }
  return new CosmosClient({ endpoint, key });
}

export async function savePin(pin: MapPin): Promise<void> {
  const client = getClient();
  const container = client.database(DB_NAME).container(CONTAINER_NAME);
  await container.items.create(pin);
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
