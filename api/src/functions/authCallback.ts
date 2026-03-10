import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { signToken, parseCookie, isGuildMember, getDiscordUser, createExchangeCode } from '../shared/auth.js';
import { getAllowedOrigin } from '../shared/response.js';

/**
 * GET /api/auth/callback?code=...&state=...
 *
 * Handles the Discord OAuth2 redirect. Verifies the CSRF state, exchanges the
 * authorization code for a Discord access token, verifies guild membership, then
 * issues a one-time exchange code and redirects to the frontend. The frontend
 * exchanges the code for a JWT via /api/auth/exchange — keeping the full JWT out
 * of the URL and browser history.
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

  // CSRF: verify state param matches the cookie set in authLogin
  const state = request.query.get('state');
  const cookieHeader = request.headers.get('cookie') ?? '';
  const storedState = parseCookie(cookieHeader, 'oauth_state');
  if (!state || !storedState || state !== storedState) {
    context.error('OAuth state mismatch — possible CSRF attack');
    return { status: 400, body: JSON.stringify({ error: 'Invalid OAuth state' }) };
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const frontendUrl = getAllowedOrigin();

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

    // Sign JWT and wrap in a short-lived one-time exchange code.
    // The code (not the JWT itself) goes in the URL fragment — the frontend immediately
    // exchanges it via /api/auth/exchange, keeping the full JWT out of browser history.
    const sessionToken = await signToken({
      userId: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
    });
    const exchangeCode = createExchangeCode(sessionToken);

    return {
      status: 302,
      headers: {
        Location: `${frontendUrl}#code=${exchangeCode}`,
        // Clear the CSRF state cookie now that the callback has completed.
        'Set-Cookie': 'oauth_state=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
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
