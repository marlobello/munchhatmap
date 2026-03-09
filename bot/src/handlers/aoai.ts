import { AzureOpenAI } from 'openai';

const endpoint   = process.env.AZURE_OPENAI_ENDPOINT ?? '';
const apiKey     = process.env.AZURE_OPENAI_API_KEY   ?? '';
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI | null {
  if (!endpoint || !apiKey) return null;
  if (!_client) {
    _client = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-10-21', deployment });
  }
  return _client;
}

export interface LocationInfo {
  lat: number;
  lng: number;
  country?: string;
  state?: string;      // US state only — null/undefined for non-US locations
  place_name?: string; // Descriptive name of the specific location
}

// System prompt used for both text and image geocoding.
// Returns coordinates + country/state in a single call — no follow-up reverse geocode needed.
const GEOCODE_SYSTEM_PROMPT = `You are a precise geographic coordinate resolver.
Given a Discord message or photo, identify the most specific real-world location and return ONLY valid JSON:
{"lat": <number>, "lng": <number>, "country": "<full country name in English>", "state": "<US state full name, or null>", "place_name": "<descriptive name>"}
Rules:
- Be as specific as possible: use coordinates for a named landmark/restaurant/venue if mentioned, not just the city.
- If only a city or region is mentioned, return coordinates for its centre.
- "state" must only be populated for locations inside the United States; set to null for all other countries.
- If you genuinely cannot determine any location, return exactly: null
- Return ONLY the JSON object or null — no explanation, no markdown, no code fences.`;

// Prompt for reverse geocoding coordinates → country/state only (used for EXIF GPS path).
const REVERSE_SYSTEM_PROMPT = `Given GPS coordinates, return the country and US state (if applicable).
Return ONLY valid JSON: {"country": "<full country name in English>", "state": "<US state full name, or null>"}
- "state" must only be populated for locations inside the United States; set to null for all other countries.
- Return ONLY the JSON — no explanation, no markdown, no code fences.`;

function parseGeocodeResponse(content: string | null): LocationInfo | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed === 'null') return null;
  try {
    const parsed = JSON.parse(trimmed) as { lat?: unknown; lng?: unknown; country?: unknown; state?: unknown };
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (lat === 0 && lng === 0) return null; // sentinel for "unknown" — reject
    return {
      lat,
      lng,
      country: typeof parsed.country === 'string' ? parsed.country : undefined,
      state:   typeof parsed.state   === 'string' ? parsed.state   : undefined,
    };
  } catch {
    return null;
  }
}

function parseReverseResponse(content: string | null): Pick<LocationInfo, 'country' | 'state'> | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed === 'null') return null;
  try {
    const parsed = JSON.parse(trimmed) as { country?: unknown; state?: unknown };
    return {
      country: typeof parsed.country === 'string' ? parsed.country : undefined,
      state:   typeof parsed.state   === 'string' ? parsed.state   : undefined,
    };
  } catch {
    return null;
  }
}

async function callAoai(messages: Parameters<AzureOpenAI['chat']['completions']['create']>[0]['messages'], maxTokens = 120): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const response = await client.chat.completions.create({ model: deployment, temperature: 0, max_tokens: maxTokens, messages });
    return response.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.error('[aoai] API call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Geocodes a Discord message text using AOAI.
 * Returns full LocationInfo (lat, lng, country, state) in a single call.
 */
export async function geocodeWithText(messageText: string): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping text geocoding'); return null; }
  if (!messageText.trim()) return null;
  const content = await callAoai([
    { role: 'system', content: GEOCODE_SYSTEM_PROMPT },
    { role: 'user',   content: `Discord message: "${messageText}"` },
  ]);
  const result = parseGeocodeResponse(content);
  console.log(`[aoai] text "${messageText.slice(0, 60)}" → ${content?.slice(0, 100)}`);
  return result;
}

/**
 * Geocodes an image URL using AOAI vision.
 * Returns full LocationInfo (lat, lng, country, state) in a single call.
 */
export async function geocodeWithImage(imageUrl: string): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping image geocoding'); return null; }
  const content = await callAoai([
    { role: 'system', content: GEOCODE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Identify the geographic location shown in this photo and return coordinates as instructed.' },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
      ],
    },
  ]);
  const result = parseGeocodeResponse(content);
  console.log(`[aoai] image → ${content?.slice(0, 100)}`);
  return result;
}

/**
 * Reverse geocodes GPS coordinates to country + US state using AOAI.
 * Used for the EXIF GPS path where we already have coordinates.
 */
export async function reverseGeocodeWithAoai(lat: number, lng: number): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping reverse geocoding'); return null; }
  const content = await callAoai([
    { role: 'system', content: REVERSE_SYSTEM_PROMPT },
    { role: 'user',   content: `Coordinates: lat=${lat}, lng=${lng}` },
  ], 60);
  const meta = parseReverseResponse(content);
  if (!meta) return { lat, lng };
  console.log(`[aoai] reverse ${lat},${lng} → ${content?.slice(0, 80)}`);
  return { lat, lng, ...meta };
}
