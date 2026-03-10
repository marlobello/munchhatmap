import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getAllowedOrigin } from '../shared/response.js';

/**
 * GET /api/auth/logout
 *
 * Redirects to the frontend with ?logout=1. Frontend clears the localStorage token.
 */
async function authLogoutHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogout invoked');
  return { status: 302, headers: { Location: `${getAllowedOrigin()}?logout=1` } };
}

app.http('authLogout', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogoutHandler,
});
