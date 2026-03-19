import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';
import { getPinById, deletePin } from '../shared/db.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';

/**
 * DELETE /api/deletePin
 *
 * Permanently removes a pin from Cosmos DB.
 * Permission: the pin's owner OR elevated members (MOD role / admins).
 *
 * Body: { pinId: string, guildId: string }
 * Response 204: no content
 */
async function deletePinHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('deletePin invoked');

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders() };
  }

  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON' });
  }

  const { pinId, guildId } = body as Record<string, unknown>;

  if (typeof pinId !== 'string' || !pinId) return jsonResponse(400, { error: 'pinId is required' });
  if (typeof guildId !== 'string' || !guildId) return jsonResponse(400, { error: 'guildId is required' });

  // Fetch the pin first so we can verify ownership.
  const pin = await getPinById(pinId, guildId);
  if (!pin) return jsonResponse(404, { error: 'Pin not found' });

  const canDelete = user.userId === pin.userId || (user.isElevated ?? false);
  if (!canDelete) {
    return jsonResponse(403, { error: 'You can only delete your own pins' });
  }

  await deletePin(pinId, guildId);

  context.log(`deletePin: removed ${pinId} (guild ${guildId}) by ${user.userId}`);

  return { status: 204, headers: corsHeaders() };
}

app.http('deletePin', {
  methods: ['DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'deletePin',
  handler: deletePinHandler,
});
