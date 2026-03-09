import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * GET /api/auth/login
 *
 * Redirects the browser to Discord's OAuth2 authorization page.
 * Scopes: identify (user profile) + guilds.members.read (guild membership check).
 */
async function authLoginHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authLogin invoked');

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    context.error('Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI');
    return { status: 500, body: JSON.stringify({ error: 'Auth not configured' }) };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
  });

  return {
    status: 302,
    headers: { Location: `https://discord.com/oauth2/authorize?${params.toString()}` },
  };
}

app.http('authLogin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLoginHandler,
});
