import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getPins } from '../shared/db.js';
import { generateSasUrl } from '../shared/blobSas.js';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';
import { trackMetric } from '../shared/telemetry.js';

const STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? '';

/** True if the URL points to our private blob container but carries no SAS signature (a failed SAS sign). */
function isUnsignedBlobUrl(url: string): boolean {
  return (
    STORAGE_ACCOUNT_NAME.length > 0 &&
    url.includes(`${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`) &&
    !url.includes('sig=')
  );
}

/**
 * GET /api/getPins
 *
 * Returns all MapPin records as JSON. Requires a valid JWT Bearer token.
 *
 * Accepted query params (all optional):
 *   ?guildId=...&channelId=...&userId=...
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

    // Emit an aggregate metric so a spike in SAS-signing failures (broken images) is alertable.
    const sasFailures = pins.filter((p) => p.imageUrl && isUnsignedBlobUrl(p.imageUrl)).length;
    trackMetric('PinsWithFailedSas', sasFailures, { totalPins: String(pins.length) });
    if (sasFailures > 0) {
      context.warn(`getPins: ${sasFailures}/${pins.length} blob images returned without a SAS token`);
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify(pins),
    };
  } catch (err) {
    context.error('Error fetching pins:', err instanceof Error ? err.message : err);
    return jsonResponse(500, { error: 'Failed to retrieve pins' });
  }
}

app.http('getPins', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getPinsHandler,
});
