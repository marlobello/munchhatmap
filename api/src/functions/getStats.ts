import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

let _client: CosmosClient | null = null;

function getClient(): CosmosClient {
  if (_client) return _client;
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;
  if (!endpoint || !key) throw new Error('Missing Cosmos DB configuration');
  _client = new CosmosClient({ endpoint, key });
  return _client;
}

const DB_NAME = 'munchhatmap';
const CONTAINER_NAME = 'pins';

interface PinStatsRow {
  userId: string;
  username?: string;
  country?: string;
  state?: string;
}

interface StatsResponse {
  users: Array<{ userId: string; username: string; count: number }>;
  states: Array<{ name: string; count: number }>;
  countries: Array<{ name: string; count: number }>;
}

async function getStatsHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('getStats invoked');

  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;
  if (!endpoint || !key) {
    return { status: 500, body: JSON.stringify({ error: 'Missing Cosmos DB configuration' }) };
  }

  try {
    const client = getClient();
    const container = client.database(DB_NAME).container(CONTAINER_NAME);

    const { resources } = await container.items
      .query<PinStatsRow>('SELECT c.userId, c.username, c.country, c.state FROM c')
      .fetchAll();

    // Aggregate users
    const userMap = new Map<string, { username: string; count: number }>();
    for (const pin of resources) {
      const existing = userMap.get(pin.userId);
      if (existing) {
        existing.count++;
        if (pin.username) existing.username = pin.username;
      } else {
        userMap.set(pin.userId, { username: pin.username ?? pin.userId, count: 1 });
      }
    }
    const users = [...userMap.entries()]
      .map(([userId, { username, count }]) => ({ userId, username, count }))
      .sort((a, b) => b.count - a.count);

    // Aggregate US states
    const stateMap = new Map<string, number>();
    for (const pin of resources) {
      if (pin.country?.toLowerCase().includes('united states') && pin.state) {
        stateMap.set(pin.state, (stateMap.get(pin.state) ?? 0) + 1);
      }
    }
    const states = [...stateMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Aggregate foreign countries
    const countryMap = new Map<string, number>();
    for (const pin of resources) {
      if (pin.country && !pin.country.toLowerCase().includes('united states')) {
        countryMap.set(pin.country, (countryMap.get(pin.country) ?? 0) + 1);
      }
    }
    const countries = [...countryMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const stats: StatsResponse = { users, states, countries };

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(stats),
    };
  } catch (err) {
    context.error('Error computing stats:', err instanceof Error ? err.message : err);
    return { status: 500, body: JSON.stringify({ error: 'Failed to compute stats' }) };
  }
}

app.http('getStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getStatsHandler,
});
