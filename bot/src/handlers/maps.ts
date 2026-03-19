/**
 * bot/src/handlers/maps.ts
 *
 * Azure Maps Search helpers for the bot.
 *
 * Provides:
 *   reverseGeocodeWithMaps(lat, lng) — replaces AOAI reverse geocoding for the EXIF GPS path
 *   forwardGeocodeWithMaps(query)   — used by the hybrid Step 2 text geocoding path
 *
 * Auth:
 *   Local dev  → AZURE_MAPS_KEY subscription key
 *   Production → DefaultAzureCredential + AZURE_MAPS_CLIENT_ID (Maps account uniqueId)
 */

import { DefaultAzureCredential } from '@azure/identity';
import type { LocationInfo } from './aoai.js';
import { fetchWithTimeout } from './http.js';

const MAPS_BASE      = 'https://atlas.microsoft.com';
const subscriptionKey = process.env.AZURE_MAPS_KEY       ?? '';
const mapsClientId    = process.env.AZURE_MAPS_CLIENT_ID ?? '';

let _credential: DefaultAzureCredential | null = null;

/** Returns true when at least one auth method is configured. */
export function isMapsConfigured(): boolean {
  return Boolean(subscriptionKey || mapsClientId);
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
 * Reverse geocodes GPS coordinates using Azure Maps.
 * Returns LocationInfo with country, state (US only), and place_name.
 * Returns null when Maps is not configured or the request fails.
 */
export async function reverseGeocodeWithMaps(lat: number, lng: number): Promise<LocationInfo | null> {
  if (!isMapsConfigured()) {
    console.warn('[maps] not configured — AZURE_MAPS_KEY or AZURE_MAPS_CLIENT_ID required');
    return null;
  }
  try {
    const headers = await getAuthHeaders();
    // Azure Maps uses GeoJSON coordinate order: [longitude, latitude]
    const url = `${MAPS_BASE}/reverseGeocode?api-version=2023-06-01&coordinates=${lng},${lat}`;
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) {
      console.error(`[maps] reverse geocode HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json() as AzureMapsReverseResponse;
    const feature = data.features?.[0];
    const addr    = feature?.properties?.address;
    if (!addr) return null;

    const country    = addr.country ?? undefined;
    const isUS       = addr.countryCode === 'US';
    const state      = isUS ? (addr.countrySubdivisionName ?? addr.countrySubdivision ?? undefined) : undefined;
    const place_name = buildReverseGeoPlaceName(addr);
    console.log(`[maps] reverse ${lat},${lng} → ${place_name ?? 'unknown'}, ${country ?? 'unknown'}`);
    return { lat, lng, country, state, place_name };
  } catch (err) {
    console.error('[maps] reverse geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Forward geocodes a location query string using Azure Maps fuzzy search.
 * Returns full LocationInfo with authoritative coordinates, country, state, and place_name.
 * Returns null when Maps is not configured, the query is empty, or no result is found.
 */
export async function forwardGeocodeWithMaps(query: string): Promise<LocationInfo | null> {
  if (!isMapsConfigured() || !query.trim()) return null;
  try {
    const headers = await getAuthHeaders();
    const url = `${MAPS_BASE}/search/fuzzy/json?api-version=1.0&query=${encodeURIComponent(query)}&limit=1`;
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) {
      console.error(`[maps] fuzzy search HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const data   = await res.json() as AzureMapsSearchResponse;
    const result = data.results?.[0];
    if (!result?.position) return null;

    const { lat, lon } = result.position;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180)  return null;

    const addr       = result.address;
    const country    = addr?.country ?? undefined;
    const isUS       = addr?.countryCode === 'US';
    const state      = isUS ? (addr?.countrySubdivisionName ?? addr?.countrySubdivision ?? undefined) : undefined;
    const place_name = buildSearchResultPlaceName(result);
    console.log(`[maps] forward "${query}" → ${lat},${lon} (${place_name ?? 'unknown'})`);
    return { lat, lng: lon, country, state, place_name };
  } catch (err) {
    console.error('[maps] forward geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildReverseGeoPlaceName(addr: AzureMapsAddress): string | undefined {
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

function buildSearchResultPlaceName(result: AzureMapsSearchResult): string | undefined {
  if (result.poi?.name) return result.poi.name;
  return buildReverseGeoPlaceName(result.address ?? {});
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

interface AzureMapsSearchResult {
  position?: { lat: number; lon: number };
  address?: AzureMapsAddress;
  poi?: { name?: string };
}

interface AzureMapsSearchResponse {
  results?: AzureMapsSearchResult[];
}
