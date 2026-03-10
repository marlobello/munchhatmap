import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getCosmosClient } from '../shared/db.js';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';

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

/** Aggregates an array of items by a string field, returning sorted [{name, count}]. */
function aggregateByField<T>(
  items: T[],
  keyFn: (item: T) => string | undefined,
  filter?: (item: T) => boolean,
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (filter && !filter(item)) continue;
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

async function getStatsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('getStats invoked');

  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  if (!process.env.COSMOS_DB_ENDPOINT) {
    return jsonResponse(500, { error: 'Missing Cosmos DB configuration' });
  }

  try {
    const container = getCosmosClient().database(DB_NAME).container(CONTAINER_NAME);

    // Filter by configured guild to avoid cross-partition fan-out.
    const guildId = process.env.DISCORD_GUILD_ID;
    const querySpec = guildId
      ? {
          query: 'SELECT c.userId, c.username, c.country, c.state FROM c WHERE c.guildId = @guildId',
          parameters: [{ name: '@guildId', value: guildId }],
        }
      : { query: 'SELECT c.userId, c.username, c.country, c.state FROM c' };

    const { resources } = await container.items.query<PinStatsRow>(querySpec).fetchAll();

    // Aggregate users (special case: track latest username)
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

    const isUS = (p: PinStatsRow) => !!p.country?.toLowerCase().includes('united states');

    const stats: StatsResponse = {
      users,
      states:    aggregateByField(resources, (p) => p.state,   (p) => isUS(p) && !!p.state),
      countries: aggregateByField(resources, (p) => p.country, (p) => !isUS(p)),
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify(stats),
    };
  } catch (err) {
    context.error('Error computing stats:', err instanceof Error ? err.message : err);
    return jsonResponse(500, { error: 'Failed to compute stats' });
  }
}

app.http('getStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getStatsHandler,
});
