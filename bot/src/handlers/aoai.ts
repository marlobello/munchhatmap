import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const endpoint   = process.env.AZURE_OPENAI_ENDPOINT ?? '';
const apiKey     = process.env.AZURE_OPENAI_API_KEY   ?? ''; // only used for local dev
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI | null {
  if (!endpoint) return null;
  if (!_client) {
    if (apiKey) {
      // Local dev: use API key if provided
      _client = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-10-21', deployment });
    } else {
      // Production: use managed identity token provider
      const credential = new DefaultAzureCredential();
      const azureADTokenProvider = getBearerTokenProvider(
        credential,
        'https://cognitiveservices.azure.com/.default',
      );
      _client = new AzureOpenAI({ endpoint, azureADTokenProvider, apiVersion: '2024-10-21', deployment });
    }
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
const GEOCODE_SYSTEM_PROMPT = `You are a precise geographic coordinate resolver with deep knowledge of world geography including small towns, villages, and minor landmarks.

Given a Discord message or photo, identify the most specific real-world location and return ONLY valid JSON:
{"lat": <number>, "lng": <number>, "country": "<full country name in English>", "state": "<US state full name, or null>", "place_name": "<descriptive name>"}

CRITICAL RULES — read carefully:

1. NAMED PLACES ARE THE TARGET. If a specific named place is mentioned (a city, town, village, landmark, restaurant, park, body of water — no matter how small), geocode THAT place. Do not use nearby cities as a substitute.
   - "Genola, Utah...10 miles west of Payson, Utah" → geocode Genola, Utah (the named place), not Payson
   - "Little Cottonwood Canyon, Utah" → geocode Little Cottonwood Canyon, not Salt Lake City
   - "Magnolia Bakery, NYC" → geocode the bakery, not NYC

2. DIRECTIONAL PHRASES ARE CONTEXT, NOT THE TARGET. Phrases like "X miles [direction] of [city]" or "near [city]" describe WHERE a named place is — they are NOT instructions to use that city as the location. The named place before the directional phrase is the target.

3. REASON BEFORE RESOLVING. If a named place seems obscure, think: do you know this specific place? Small towns, unincorporated communities, and minor landmarks are often in your training data. Attempt to place them precisely before falling back to a broader area.

4. RELATIVE DIRECTION FALLBACK. If NO specific named place is given and only a directional description exists (e.g. "somewhere near Denver"), then compute approximate coordinates using the reference point and direction/distance.

5. Be as specific as possible: use coordinates for a named venue/restaurant/landmark if mentioned.

6. Country names, island names, regions, and named bodies of water (e.g. "Dominican Republic", "Patagonia", "Gulf of Mexico", "South China Sea") are valid — return their geographic centre.

7. "state" must only be populated for locations inside the United States; set to null for all other countries.

8. Only return null if the text contains absolutely no geographic information whatsoever.

9. Return ONLY the JSON object or null — no explanation, no markdown, no code fences.`;

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
    const parsed = JSON.parse(trimmed) as { lat?: unknown; lng?: unknown; country?: unknown; state?: unknown; place_name?: unknown };
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (lat === 0 && lng === 0) return null; // sentinel for "unknown" — reject
    return {
      lat,
      lng,
      country:    typeof parsed.country    === 'string' ? parsed.country    : undefined,
      state:      typeof parsed.state      === 'string' ? parsed.state      : undefined,
      place_name: typeof parsed.place_name === 'string' ? parsed.place_name : undefined,
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
 * Returns full LocationInfo (lat, lng, country, state, place_name) in a single call.
 * If onRaw is provided, it is called with the raw AOAI response string (for debug logging).
 */
export async function geocodeWithText(messageText: string, onRaw?: (raw: string | null) => void): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping text geocoding'); return null; }
  if (!messageText.trim()) return null;
  const content = await callAoai([
    { role: 'system', content: GEOCODE_SYSTEM_PROMPT },
    { role: 'user',   content: `Discord message: "${messageText}"` },
  ]);
  onRaw?.(content);
  const result = parseGeocodeResponse(content);
  console.log(`[aoai] text "${messageText.slice(0, 60)}" → ${content?.slice(0, 100)}`);
  return result;
}

/**
 * Geocodes an image URL using AOAI vision.
 * Returns full LocationInfo (lat, lng, country, state, place_name) in a single call.
 * If onRaw is provided, it is called with the raw AOAI response string (for debug logging).
 */
export async function geocodeWithImage(imageUrl: string, onRaw?: (raw: string | null) => void): Promise<LocationInfo | null> {
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
  onRaw?.(content);
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
