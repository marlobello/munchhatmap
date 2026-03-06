import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * GET /api/auth/logout
 *
 * Phase 2 placeholder: clears the user's session.
 *
 * TODO (Phase 2): clear session cookie / invalidate JWT.
 */
async function authLogoutHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogout invoked (placeholder)');
  return {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Logout not yet implemented (Phase 2)' }),
  };
}

app.http('authLogout', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogoutHandler,
});
