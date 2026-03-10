import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { HttpRequest } from '@azure/functions';
import { randomUUID } from 'crypto';

const TOKEN_COOKIE = 'munchhat_session';
const JWT_AUDIENCE = 'munchhatmap';
const JWT_ISSUER = 'munchhatmap-api';

export interface SessionUser {
  userId: string;
  username: string;
  avatar: string | null;
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
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

export function getCookieHeader(token: string): string {
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  // SameSite=None required because the API is cross-origin from the frontend (azurewebsites.net ≠ custom domain)
  return `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export function getClearCookieHeader(): string {
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

export function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Extracts the validated session user from the Authorization Bearer header, or returns null. */
export async function getSessionUser(request: HttpRequest): Promise<SessionUser | null> {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyToken(token);
}

/** Verifies the user is a member of the configured Discord guild. */
export async function isGuildMember(discordAccessToken: string): Promise<boolean> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error('DISCORD_GUILD_ID environment variable is required');

  const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });
  return res.ok;
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
      'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://munchhatmap.dotheneedful.dev',
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({ error: message }),
  };
}

// ─── One-time exchange codes ────────────────────────────────────────────────
// Short-lived codes used to hand off the JWT after OAuth callback without
// exposing the full token in the URL fragment or browser history.

interface ExchangeEntry { jwt: string; expiresAt: number; }
const _exchangeCodes = new Map<string, ExchangeEntry>();

/** Creates a one-time code that can be exchanged for the given JWT within 60 seconds. */
export function createExchangeCode(jwt: string): string {
  const code = randomUUID();
  _exchangeCodes.set(code, { jwt, expiresAt: Date.now() + 60_000 });
  return code;
}

/** Redeems a one-time code, returning the JWT or null if invalid/expired. Always deletes the code. */
export function redeemExchangeCode(code: string): string | null {
  const entry = _exchangeCodes.get(code);
  _exchangeCodes.delete(code);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.jwt;
}
