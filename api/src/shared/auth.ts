import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { HttpRequest } from '@azure/functions';
import { getAllowedOrigin } from './response.js';

const TOKEN_COOKIE = 'munchhat_session';
const JWT_AUDIENCE = 'munchhatmap';
const JWT_ISSUER = 'munchhatmap-api';

export interface SessionUser {
  userId: string;
  username: string;
  avatar: string | null;
  isElevated: boolean;
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

export async function signToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('7d')
    .sign(getSessionSecret());
}

export async function verifyToken(token: string): Promise<(JWTPayload & SessionUser) | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as JWTPayload & SessionUser;
  } catch {
    return null;
  }
}

export function parseCookie(cookieHeader: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Extracts the validated session user from the Authorization Bearer header, or returns null. */
export async function getSessionUser(request: HttpRequest): Promise<SessionUser | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyToken(token);
}

/**
 * Verifies guild membership and checks if the user holds an elevated (MOD/admin) role.
 * Elevation is determined by matching the user's role IDs against DISCORD_MOD_ROLE_ID
 * (comma-separated list of role IDs that are considered elevated).
 */
export async function getGuildMemberInfo(discordAccessToken: string): Promise<{
  isMember: boolean;
  isElevated: boolean;
}> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error('DISCORD_GUILD_ID environment variable is required');

  const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });
  if (!res.ok) return { isMember: false, isElevated: false };

  const member = (await res.json()) as { roles: string[] };

  const elevatedRoleIds = (process.env.DISCORD_MOD_ROLE_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isElevated =
    elevatedRoleIds.length > 0 && member.roles.some((id) => elevatedRoleIds.includes(id));

  return { isMember: true, isElevated };
}

/** Fetches the Discord user profile for the given access token. */
export async function getDiscordUser(discordAccessToken: string): Promise<{
  id: string;
  username: string;
  avatar: string | null;
}> {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status}`);
  const data = (await res.json()) as { id: string; username: string; avatar: string | null };
  return data;
}

/** Returns a 401 JSON response — used by protected endpoints. */
export function unauthorizedResponse(message = 'Authentication required'): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(),
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({ error: message }),
  };
}

// ─── One-time exchange codes ────────────────────────────────────────────────
// Short-lived codes used to hand off the JWT after OAuth callback without
// exposing the full token in the URL fragment or browser history.
//
// Implemented as self-contained short-lived signed JWTs (60s) so no server-side
// state is required. This works correctly across Azure Function instances and
// cold starts — a plain in-memory Map would be lost on any new instance.

const EXCHANGE_TYPE = 'exchange';

/**
 * Creates a one-time exchange code — a signed JWT valid for 60 seconds.
 * The code contains the full session payload and is verified on redeem.
 * No server-side state is required, so it works across function instances.
 */
export async function createExchangeCode(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user, type: EXCHANGE_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('60s')
    .sign(getSessionSecret());
}

/**
 * Redeems an exchange code, returning the session user if the code is valid
 * and unexpired, or null otherwise.
 */
export async function redeemExchangeCode(code: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(code, getSessionSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if ((payload as Record<string, unknown>).type !== EXCHANGE_TYPE) return null;
    const { userId, username, avatar, isElevated } = payload as JWTPayload & SessionUser & { type: string };
    if (!userId || !username) return null;
    return { userId, username, avatar: avatar ?? null, isElevated: isElevated ?? false };
  } catch {
    return null;
  }
}
