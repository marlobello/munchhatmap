import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * GET /api/auth/callback
 *
 * Phase 2 placeholder: handles the Discord OAuth2 redirect callback.
 * Exchanges the authorization code for tokens, verifies guild membership,
 * and creates a session (signed JWT or server-side session).
 *
 * TODO (Phase 2): exchange code, verify guild membership, set session cookie.
 */
async function authCallbackHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authCallback invoked (placeholder)');
  return {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Discord OAuth2 callback not yet implemented (Phase 2)' }),
  };
}

app.http('authCallback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/callback',
  handler: authCallbackHandler,
});
