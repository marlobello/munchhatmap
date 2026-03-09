import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSessionUser } from '../shared/auth.js';

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
  if (!user) {
    return {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ error: 'Not authenticated' }),
    };
  }
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev',
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({
      userId: user.userId,
      username: user.username,
      avatar: user.avatar,
    }),
  };
}

app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: authMeHandler,
});
