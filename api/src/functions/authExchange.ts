import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { redeemExchangeCode } from '../shared/auth.js';

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
  if (!code) {
    return { status: 400, body: JSON.stringify({ error: 'Missing code' }) };
  }

  const jwt = redeemExchangeCode(code);
  if (!jwt) {
    return { status: 400, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  const origin = process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev';
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({ token: jwt }),
  };
}

app.http('authExchange', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/exchange',
  handler: authExchangeHandler,
});
