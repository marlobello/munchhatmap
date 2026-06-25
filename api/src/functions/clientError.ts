import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';
import { trackEvent } from '../shared/telemetry.js';

/**
 * POST /api/clientError
 *
 * Lightweight client-side error sink. The frontend reports browser-side failures
 * (notably pin image load errors) so they are visible in Application Insights —
 * otherwise these failures are invisible to the backend.
 *
 * Requires a valid session: the app is auth-gated, so any real client error already
 * holds a token. This prevents the endpoint from being an anonymous telemetry spam sink.
 *
 * Body: { type: string, message?: string, url?: string }
 * Response 204: accepted (always — telemetry must never surface errors to the user)
 */

const ALLOWED_TYPES = new Set(['image_error', 'js_error', 'api_error']);
const MAX_FIELD_LENGTH = 500;

/** Trims a value to a safe string, capped in length. Returns undefined for non-strings. */
function safeStr(value: unknown, max = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, max);
}

/** Strips the query string (which carries SAS signatures) so secrets are never logged. */
function stripQuery(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

async function clientErrorHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders() };
  }

  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON' });
  }

  const { type, message, url } = body as Record<string, unknown>;
  const safeType = safeStr(type, 50);
  if (!safeType || !ALLOWED_TYPES.has(safeType)) {
    return jsonResponse(400, { error: 'Invalid error type' });
  }

  trackEvent('ClientError', {
    type: safeType,
    message: safeStr(message) ?? '',
    url: stripQuery(safeStr(url, 1000)) ?? '',
    userId: user.userId,
    userAgent: safeStr(request.headers.get('user-agent') ?? '', 300) ?? '',
  });

  context.warn(`clientError [${safeType}] from ${user.userId}: ${stripQuery(safeStr(url, 1000)) ?? ''}`);

  return { status: 204, headers: corsHeaders() };
}

app.http('clientError', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'clientError',
  handler: clientErrorHandler,
});
