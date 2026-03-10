import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSessionUser } from '../shared/auth.js';
import { jsonResponse } from '../shared/response.js';

/**
 * GET /api/auth/me
 *
 * Returns the current user's session info, or 401 if not authenticated.
 * Used by the frontend to decide whether to show the login button or the map.
 */
async function authMeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authMe invoked');
  const user = await getSessionUser(request);
  if (!user) return jsonResponse(401, { error: 'Not authenticated' });
  return jsonResponse(200, { userId: user.userId, username: user.username, avatar: user.avatar });
}

app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: authMeHandler,
});
