import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const endpoint   = process.env.AZURE_OPENAI_ENDPOINT ?? '';
const apiKey     = process.env.AZURE_OPENAI_API_KEY   ?? ''; // only used for local dev
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-5-mini';

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI | null {
  if (!endpoint) return null;
  if (!_client) {
    if (apiKey) {
      // Local dev: use API key if provided
      _client = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2025-03-01-preview', deployment });
    } else {
      // Production: use managed identity token provider
      const credential = new DefaultAzureCredential();
      const azureADTokenProvider = getBearerTokenProvider(
        credential,
        'https://cognitiveservices.azure.com/.default',
      );
      _client = new AzureOpenAI({ endpoint, azureADTokenProvider, apiVersion: '2025-03-01-preview', deployment });
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
const GEOCODE_SYSTEM_PROMPT = `You are an expert geographer with encyclopedic knowledge of locations worldwide, including small towns, villages, minor landmarks, and geographic features. Be as precise as you can be. You may need to perform internet searches to find results to help you narrow down a precise location.

Given a Discord message or photo, your goal is to identify the single most accurate real-world location and return it as ONLY valid JSON:
{"lat": <number>, "lng": <number>, "country": "<full country name in English>", "state": "<US state full name, or null>", "place_name": "<descriptive name>"}

When reading a message, pay close attention to which place is actually being described versus which places are merely mentioned as context or reference points. For example, a named town or landmark is the target location even when a more prominent nearby city is mentioned for orientation. Directional phrases like "X miles from Y" or "near Y" tell you where something is — they do not make Y the location.

Prefer precision: if a specific venue, restaurant, park, canyon, or named place of any size is mentioned, return its coordinates rather than the nearest city. Small towns and unincorporated communities are often well within your geographic knowledge — reason carefully before broadening to a larger region. Use an internet search to find addresses if this helps.

Geographic regions, island names, countries, and named bodies of water such as the Gulf of Mexico or South China Sea are all valid locations; return their geographic centre. The "state" field applies only to locations within the United States.

Return null only when the message contains absolutely no geographic information. Return ONLY the JSON object or null — no explanation, no markdown, no code fences.`;

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

async function callAoai(
  messages: Parameters<AzureOpenAI['chat']['completions']['create']>[0]['messages'],
  maxTokens = 120,
  onError?: (err: string) => void,
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    const msg = `AOAI client not initialised — endpoint="${endpoint || '(not set)'}"`;
    console.warn('[aoai]', msg);
    onError?.(msg);
    return null;
  }
  try {
    const response = await client.chat.completions.create({ model: deployment, temperature: 0, max_completion_tokens: maxTokens, messages });
    return response.choices[0]?.message?.content ?? null;
  } catch (err) {
    // Extract structured detail from OpenAI SDK errors where available
    const detail = (() => {
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        const parts: string[] = [];
        if (e['status'])  parts.push(`HTTP ${e['status']}`);
        if (e['code'])    parts.push(`code=${e['code']}`);
        if (e['message']) parts.push(String(e['message']));
        if (parts.length) return parts.join(' | ');
      }
      return err instanceof Error ? err.message : String(err);
    })();
    console.error('[aoai] API call failed:', detail);
    onError?.(detail);
    return null;
  }
}

/**
 * Geocodes a Discord message text using AOAI.
 * Returns full LocationInfo (lat, lng, country, state, place_name) in a single call.
 * onRaw is called with (rawResponse, errorDetail?) — errorDetail is set on API failure.
 */
export async function geocodeWithText(messageText: string, onRaw?: (raw: string | null, err?: string) => void): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping text geocoding'); onRaw?.(null, `AOAI client not initialised — endpoint="${endpoint || '(not set)'}"`); return null; }
  if (!messageText.trim()) return null;
  let apiError: string | undefined;
  const content = await callAoai([
    { role: 'system', content: GEOCODE_SYSTEM_PROMPT },
    { role: 'user',   content: `Discord message: "${messageText}"` },
  ], 120, (e) => { apiError = e; });
  onRaw?.(content, apiError);
  const result = parseGeocodeResponse(content);
  console.log(`[aoai] text "${messageText.slice(0, 60)}" → ${content?.slice(0, 100)}`);
  return result;
}

/**
 * Geocodes an image URL using AOAI vision.
 * Returns full LocationInfo (lat, lng, country, state, place_name) in a single call.
 * onRaw is called with (rawResponse, errorDetail?) — errorDetail is set on API failure.
 */
export async function geocodeWithImage(imageUrl: string, onRaw?: (raw: string | null, err?: string) => void): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping image geocoding'); onRaw?.(null, `AOAI client not initialised — endpoint="${endpoint || '(not set)'}"`); return null; }
  let apiError: string | undefined;
  const content = await callAoai([
    { role: 'system', content: GEOCODE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Identify the geographic location shown in this photo and return coordinates as instructed.' },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
      ],
    },
  ], 120, (e) => { apiError = e; });
  onRaw?.(content, apiError);
  const result = parseGeocodeResponse(content);
  console.log(`[aoai] image → ${content?.slice(0, 100)}`);
  return result;
}

/**
 * Reverse geocodes GPS coordinates to country + US state using AOAI.
 * Used for the EXIF GPS path where we already have coordinates.
 * onRaw is called with (rawResponse, errorDetail?) — errorDetail is set on API failure.
 */
export async function reverseGeocodeWithAoai(lat: number, lng: number, onRaw?: (raw: string | null, err?: string) => void): Promise<LocationInfo | null> {
  if (!getClient()) { console.warn('[aoai] not configured — skipping reverse geocoding'); onRaw?.(null, `AOAI client not initialised — endpoint="${endpoint || '(not set)'}"`); return null; }
  let apiError: string | undefined;
  const content = await callAoai([
    { role: 'system', content: REVERSE_SYSTEM_PROMPT },
    { role: 'user',   content: `Coordinates: lat=${lat}, lng=${lng}` },
  ], 60, (e) => { apiError = e; });
  onRaw?.(content, apiError);
  const meta = parseReverseResponse(content);
  if (!meta) return { lat, lng };
  console.log(`[aoai] reverse ${lat},${lng} → ${content?.slice(0, 80)}`);
  return { lat, lng, ...meta };
}
