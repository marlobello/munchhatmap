import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getPins } from '../shared/db.js';
import { refreshDiscordUrls } from '../shared/discordRefresh.js';

/**
 * GET /api/getPins
 *
 * Returns all MapPin records as JSON.
 * Currently public (no auth). Designed for Phase 2 session/auth check.
 *
 * Accepted query params (all optional, future filtering):
 *   ?guildId=...&channelId=...&userId=...
 *
 * TODO (Phase 2): validate session cookie / JWT before returning data.
 * TODO (Production): restrict CORS origin to the Static Web App domain.
 */
async function getPinsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('getPins invoked');

  const guildId = request.query.get('guildId') ?? undefined;
  const channelId = request.query.get('channelId') ?? undefined;
  const userId = request.query.get('userId') ?? undefined;

  try {
    const pins = await getPins({ guildId, channelId, userId });

    // Refresh expiring Discord CDN URLs before returning to the client
    const imageUrls = pins.map((p) => p.imageUrl).filter((u): u is string => Boolean(u));
    if (imageUrls.length > 0) {
      const refreshed = await refreshDiscordUrls(imageUrls);
      for (const pin of pins) {
        if (pin.imageUrl) {
          pin.imageUrl = refreshed.get(pin.imageUrl) ?? pin.imageUrl;
        }
      }
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev',
      },
      body: JSON.stringify(pins),
    };
  } catch (err) {
    context.error('Error fetching pins:', err instanceof Error ? err.message : err);
    return {
      status: 500,
      body: JSON.stringify({ error: 'Failed to retrieve pins' }),
    };
  }
}

app.http('getPins', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getPinsHandler,
});
