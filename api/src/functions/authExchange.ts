import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { redeemExchangeCode, signToken } from '../shared/auth.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';

/**
 * GET /api/auth/exchange?code=...
 *
 * Exchanges a one-time code (issued by authCallback) for a signed JWT.
 * Codes are self-contained signed JWTs valid for 60 seconds, so this works
 * correctly across Azure Function instances without any shared state.
 */
async function authExchangeHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authExchange invoked');

  const code = request.query.get('code');
  if (!code) return jsonResponse(400, { error: 'Missing code' });

  const user = await redeemExchangeCode(code);
  if (!user) return jsonResponse(400, { error: 'Invalid or expired code' });

  const jwt = await signToken(user);
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
