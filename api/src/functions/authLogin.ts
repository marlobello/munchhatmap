import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * GET /api/auth/login
 *
 * Phase 2 placeholder: initiates Discord OAuth2 login flow.
 * Will redirect to Discord's OAuth2 authorization URL with guild membership scope.
 *
 * TODO (Phase 2): construct Discord OAuth2 URL and redirect.
 */
async function authLoginHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogin invoked (placeholder)');
  return {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Discord OAuth2 login not yet implemented (Phase 2)' }),
  };
}

app.http('authLogin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLoginHandler,
});
