import AzureOpenAI from 'openai';
import type { LocationInfo } from './geocoding.js';

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

const SYSTEM_PROMPT = `You are a precise geographic coordinate resolver.
Given a message or image, identify the most specific real-world location and return ONLY valid JSON in this exact format:
{"lat": <number>, "lng": <number>, "place_name": "<human readable name>"}
Rules:
- Be as specific as possible: use coordinates for a named landmark/restaurant/venue if mentioned, not just the city.
- If only a city or region is mentioned, return coordinates for its centre.
- If you genuinely cannot determine any location, return exactly: null
- Return ONLY the JSON object or null — no explanation, no markdown, no code fences.`;

function parseAoaiResponse(content: string | null): LocationInfo | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed === 'null') return null;
  try {
    const parsed = JSON.parse(trimmed) as { lat?: unknown; lng?: unknown };
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Asks AOAI to extract coordinates from the message text.
 * Returns LocationInfo on success, null if no location found or AOAI unavailable.
 */
export async function geocodeWithText(messageText: string): Promise<LocationInfo | null> {
  const client = getClient();
  if (!client) {
    console.warn('[aoai] AOAI not configured — skipping text geocoding');
    return null;
  }
  if (!messageText.trim()) return null;

  try {
    const response = await client.chat.completions.create({
      model: deployment,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Discord message: "${messageText}"` },
      ],
    });
    const content = response.choices[0]?.message?.content ?? null;
    const result = parseAoaiResponse(content);
    console.log(`[aoai] text "${messageText.slice(0, 60)}" → ${content?.slice(0, 80)}`);
    return result;
  } catch (err) {
    console.error('[aoai] text geocoding failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Asks AOAI vision to identify the location from an image URL.
 * Returns LocationInfo on success, null if no location found or AOAI unavailable.
 */
export async function geocodeWithImage(imageUrl: string): Promise<LocationInfo | null> {
  const client = getClient();
  if (!client) {
    console.warn('[aoai] AOAI not configured — skipping image geocoding');
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model: deployment,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Identify the geographic location shown in this photo and return coordinates as instructed.',
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' }, // 'low' detail = cheapest
            },
          ],
        },
      ],
    });
    const content = response.choices[0]?.message?.content ?? null;
    const result = parseAoaiResponse(content);
    console.log(`[aoai] image → ${content?.slice(0, 80)}`);
    return result;
  } catch (err) {
    console.error('[aoai] image geocoding failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
