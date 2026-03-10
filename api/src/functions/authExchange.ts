import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { redeemExchangeCode } from '../shared/auth.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';

/**
 * GET /api/auth/exchange?code=...
 *
 * Exchanges a one-time code (issued by authCallback) for a signed JWT.
 * Codes are valid for 60 seconds and destroyed on first use.
 * This keeps the full JWT out of browser history and URL bars.
 */
async function authExchangeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authExchange invoked');

  const code = request.query.get('code');
  if (!code) return jsonResponse(400, { error: 'Missing code' });

  const jwt = redeemExchangeCode(code);
  if (!jwt) return jsonResponse(400, { error: 'Invalid or expired code' });

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify({ token: jwt }),
  };
}

app.http('authExchange', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/exchange',
  handler: authExchangeHandler,
});
