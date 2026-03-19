import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSessionUser, unauthorizedResponse } from '../shared/auth.js';
import { getPinById, upsertPin } from '../shared/db.js';
import { reverseGeocode as reverseGeocodeWithMaps } from '../shared/maps.js';
import { reverseGeocode as reverseGeocodeWithAoai } from '../shared/aoai.js';
import { jsonResponse, corsHeaders } from '../shared/response.js';

/**
 * PATCH /api/updatePin
 *
 * Moves a pin to new coordinates and re-geocodes its metadata via AOAI.
 * Permission: users may move their own pins; elevated members (MOD role) may move any pin.
 *
 * Body: { pinId: string, guildId: string, lat: number, lng: number }
 * Response 200: { id, lat, lng, country, state, place_name }
 */
async function updatePinHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('updatePin invoked');

  // OPTIONS preflight
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

  const { pinId, guildId, lat, lng } = body as Record<string, unknown>;

  if (typeof pinId !== 'string' || !pinId) return jsonResponse(400, { error: 'pinId is required' });
  if (typeof guildId !== 'string' || !guildId) return jsonResponse(400, { error: 'guildId is required' });
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return jsonResponse(400, { error: 'lat must be a finite number between -90 and 90' });
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return jsonResponse(400, { error: 'lng must be a finite number between -180 and 180' });

  const pin = await getPinById(pinId, guildId);
  if (!pin) return jsonResponse(404, { error: 'Pin not found' });

  const canEdit = user.userId === pin.userId || (user.isElevated ?? false);
  if (!canEdit) return jsonResponse(403, { error: 'You do not have permission to move this pin' });

  // Update coordinates first so the change is persisted even if geocoding is slow.
  const updatedPin = { ...pin, lat, lng };
  await upsertPin(updatedPin);

  // Re-geocode the new coordinates to refresh country/state/place_name.
  // Prefer Azure Maps (authoritative, deterministic); fall back to AOAI if Maps is unavailable.
  const geo = (await reverseGeocodeWithMaps(lat, lng)) ?? (await reverseGeocodeWithAoai(lat, lng));
  if (geo) {
    updatedPin.country    = geo.country    ?? updatedPin.country;
    updatedPin.state      = geo.state      ?? updatedPin.state;
    updatedPin.place_name = geo.place_name ?? updatedPin.place_name;
    await upsertPin(updatedPin);
  }

  context.log(`updatePin: moved ${pinId} to (${lat}, ${lng}) by ${user.userId}`);

  return jsonResponse(200, {
    id:         updatedPin.id,
    lat:        updatedPin.lat,
    lng:        updatedPin.lng,
    country:    updatedPin.country,
    state:      updatedPin.state,
    place_name: updatedPin.place_name,
  });
}

app.http('updatePin', {
  methods: ['PATCH', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'updatePin',
  handler: updatePinHandler,
});
