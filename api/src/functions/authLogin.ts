import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'crypto';

/**
 * GET /api/auth/login
 *
 * Redirects the browser to Discord's OAuth2 authorization page.
 * Generates a random CSRF state token, stores it in a short-lived HttpOnly cookie,
 * and includes it in the OAuth URL. Verified in authCallback.
 */
async function authLoginHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogin invoked');

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    context.error('Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI');
    return { status: 500, body: JSON.stringify({ error: 'Auth not configured' }) };
  }

  const state = randomUUID();

  // Use prompt=none by default so returning users skip the Discord permissions page.
  // If Discord rejects prompt=none (first-time user with no existing authorization),
  // authCallback detects the error and redirects back here with ?consent=1 so the
  // full consent dialog is shown on the retry.
  const forceConsent = request.query.get('consent') === '1';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
    prompt: forceConsent ? 'consent' : 'none',
  });

  return {
    status: 302,
    headers: {
      Location: `https://discord.com/oauth2/authorize?${params.toString()}`,
      // SameSite=Lax: cookie is sent on top-level GET redirects (Discord → our callback) but
      // not on cross-site sub-resource requests. 5-minute TTL covers the OAuth round-trip.
      'Set-Cookie': `oauth_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    },
  };
}

app.http('authLogin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLoginHandler,
});
