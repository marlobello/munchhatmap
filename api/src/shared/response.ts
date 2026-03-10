/**
 * response.ts — shared HTTP response helpers for Azure Functions.
 *
 * Centralises CORS headers and JSON response construction so individual
 * function handlers don't each repeat the same header boilerplate.
 */

import type { HttpResponseInit } from '@azure/functions';

export const DEFAULT_ALLOWED_ORIGIN = 'https://munchhatmap.dotheneedful.dev';

export function getAllowedOrigin(): string {
  return process.env.ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN;
}

/** Returns the standard CORS headers for all API responses. */
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(),
    'Access-Control-Allow-Credentials': 'true',
  };
}

/** Builds a JSON response with CORS headers. */
export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

/** Builds a redirect response. */
export function redirectResponse(location: string, extraHeaders?: Record<string, string>): HttpResponseInit {
  return {
    status: 302,
    headers: { Location: location, ...extraHeaders },
  };
}
