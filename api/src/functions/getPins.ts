import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getPins } from '../shared/db.js';
import { generateSasUrl } from '../shared/blobSas.js';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';

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

  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const guildId = request.query.get('guildId') ?? undefined;
  const channelId = request.query.get('channelId') ?? undefined;
  const userId = request.query.get('userId') ?? undefined;

  try {
    const pins = await getPins({ guildId, channelId, userId });

    // Replace private blob URLs with time-limited SAS URLs so the browser can load images.
    // Discord CDN URLs (pre-migration pins) are passed through unchanged.
    // allSettled: a single SAS failure must not prevent other pins from loading.
    await Promise.allSettled(
      pins.map(async (pin) => {
        if (pin.imageUrl) {
          pin.imageUrl = await generateSasUrl(pin.imageUrl);
        }
      }),
    );

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev',
        'Access-Control-Allow-Credentials': 'true',
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
