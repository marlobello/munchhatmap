import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

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
  // Token is stored in localStorage; frontend clears it on logout redirect
  return {
    status: 302,
    headers: { Location: `${frontendUrl}?logout=1` },
  };
}

app.http('authLogout', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogoutHandler,
});
