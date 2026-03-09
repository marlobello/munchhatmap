import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { signToken, getCookieHeader, isGuildMember, getDiscordUser } from '../shared/auth.js';

/**
 * GET /api/auth/callback?code=...
 *
 * Handles the Discord OAuth2 redirect. Exchanges the authorization code for an
 * access token, verifies guild membership, then sets a signed JWT session cookie
 * and redirects to the frontend map.
 */
async function authCallbackHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('authCallback invoked');

  const code = request.query.get('code');
  if (!code) {
    return { status: 400, body: JSON.stringify({ error: 'Missing authorization code' }) };
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const frontendUrl = process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev';

  if (!clientId || !clientSecret || !redirectUri) {
    context.error('Missing OAuth2 config env vars');
    return { status: 500, body: JSON.stringify({ error: 'Auth not configured' }) };
  }

  try {
    // Exchange authorization code for Discord access token
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      context.error('Discord token exchange failed:', err);
      return { status: 401, body: JSON.stringify({ error: 'Discord token exchange failed' }) };
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // Verify guild membership before granting access
    const member = await isGuildMember(accessToken);
    if (!member) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'You must be a member of the MunchHat Discord server.' }),
      };
    }

    // Fetch Discord user profile
    const discordUser = await getDiscordUser(accessToken);

    // Issue signed JWT session cookie
    const sessionToken = await signToken({
      userId: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
    });

    return {
      status: 302,
      headers: {
        // Pass token in URL fragment — avoids third-party cookie blocking in modern browsers.
        // Fragment is never sent to the server; frontend reads it and stores in localStorage.
        Location: `${frontendUrl}#token=${sessionToken}`,
      },
    };
  } catch (err) {
    context.error('Auth callback error:', err instanceof Error ? err.message : err);
    return { status: 500, body: JSON.stringify({ error: 'Authentication failed' }) };
  }
}

app.http('authCallback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/callback',
  handler: authCallbackHandler,
});
