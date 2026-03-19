/**
 * api/src/shared/maps.ts
 *
 * Azure Maps reverse geocoding helper for the API layer.
 * Used by updatePin to refresh country/state/place_name after a pin is dragged.
 * Mirrors the bot's reverseGeocodeWithMaps() approach.
 *
 * Auth:
 *   Local dev  → AZURE_MAPS_KEY subscription key
 *   Production → DefaultAzureCredential + AZURE_MAPS_CLIENT_ID (Maps account uniqueId)
 */

import { DefaultAzureCredential } from '@azure/identity';

const MAPS_BASE       = 'https://atlas.microsoft.com';
const subscriptionKey = process.env.AZURE_MAPS_KEY       ?? '';
const mapsClientId    = process.env.AZURE_MAPS_CLIENT_ID ?? '';

let _credential: DefaultAzureCredential | null = null;

export interface ReverseGeoResult {
  country?: string;
  state?: string;
  place_name?: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  if (subscriptionKey) {
    return { 'subscription-key': subscriptionKey };
  }
  if (!_credential) _credential = new DefaultAzureCredential();
  const token = await _credential.getToken('https://atlas.microsoft.com/.default');
  return {
    Authorization: `Bearer ${token?.token ?? ''}`,
    'x-ms-client-id': mapsClientId,
  };
}

/**
 * Reverse geocodes GPS coordinates to country, state, and place_name using Azure Maps.
 * Returns null when Maps is not configured or the request fails.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeoResult | null> {
  if (!subscriptionKey && !mapsClientId) {
    console.warn('[maps-api] not configured — AZURE_MAPS_KEY or AZURE_MAPS_CLIENT_ID required');
    return null;
  }
  try {
    const headers = await getAuthHeaders();
    // Azure Maps uses GeoJSON coordinate order: [longitude, latitude]
    const url = `${MAPS_BASE}/reverseGeocode?api-version=2023-06-01&coordinates=${lng},${lat}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[maps-api] reverse geocode HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const data    = await res.json() as AzureMapsReverseResponse;
    const feature = data.features?.[0];
    const addr    = feature?.properties?.address;
    if (!addr) return null;

    const country    = typeof addr.country    === 'string' ? addr.country    : undefined;
    const isUS       = addr.countryCode === 'US';
    const state      = isUS
      ? (typeof addr.countrySubdivisionName === 'string' ? addr.countrySubdivisionName
        : typeof addr.countrySubdivision    === 'string' ? addr.countrySubdivision
        : undefined)
      : undefined;
    const place_name = buildPlaceName(addr);
    return { country, state, place_name };
  } catch (err) {
    console.error('[maps-api] reverse geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPlaceName(addr: AzureMapsAddress): string | undefined {
  const parts: string[] = [];
  if (addr.municipality) {
    parts.push(addr.municipality);
  } else if (addr.municipalitySubdivision) {
    parts.push(addr.municipalitySubdivision);
  }
  if (addr.countrySubdivisionName ?? addr.countrySubdivision) {
    parts.push((addr.countrySubdivisionName ?? addr.countrySubdivision)!);
  }
  return parts.length > 0 ? parts.join(', ') : (addr.freeformAddress ?? undefined);
}

// ── Azure Maps REST API response types ───────────────────────────────────────

interface AzureMapsAddress {
  country?: string;
  countryCode?: string;
  countrySubdivision?: string;
  countrySubdivisionName?: string;
  municipality?: string;
  municipalitySubdivision?: string;
  freeformAddress?: string;
}

interface AzureMapsReverseResponse {
  features?: Array<{
    properties?: {
      address?: AzureMapsAddress;
    };
  }>;
}
