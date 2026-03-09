import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getClearCookieHeader } from '../shared/auth.js';

/**
 * GET /api/auth/logout
 *
 * Clears the session cookie and redirects to the frontend.
 */
async function authLogoutHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogout invoked');
  const frontendUrl = process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev';
  return {
    status: 302,
    headers: {
      Location: frontendUrl,
      'Set-Cookie': getClearCookieHeader(),
    },
  };
}

app.http('authLogout', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogoutHandler,
});
