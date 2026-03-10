/**
 * api/src/shared/aoai.ts
 *
 * Reverse geocoding helper for the API layer.
 * Mirrors the bot's reverseGeocodeWithAoai() but lives in the API so that
 * the updatePin endpoint can refresh metadata after a pin is dragged.
 */

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const endpoint   = process.env.AZURE_OPENAI_ENDPOINT   ?? '';
const apiKey     = process.env.AZURE_OPENAI_API_KEY     ?? ''; // local dev only
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT  ?? 'gpt-4.1';

let _client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI | null {
  if (!endpoint) return null;
  if (!_client) {
    if (apiKey) {
      _client = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2025-03-01-preview', deployment });
    } else {
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

const REVERSE_SYSTEM_PROMPT = `Given GPS coordinates, return the country and US state (if applicable).
Return ONLY valid JSON: {"country": "<full country name in English>", "state": "<US state full name, or null>", "place_name": "<descriptive name of this location>"}
- "state" must only be populated for locations inside the United States; set to null for all other countries.
- "place_name" should be a short human-readable description such as a city, town, or landmark name.
- Return ONLY the JSON — no explanation, no markdown, no code fences.`;

export interface ReverseGeoResult {
  country?: string;
  state?: string;
  place_name?: string;
}

/**
 * Reverse geocodes GPS coordinates to country, state, and place_name using AOAI.
 * Returns null if AOAI is not configured or fails to produce a valid response.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeoResult | null> {
  const client = getClient();
  if (!client) {
    console.warn('[aoai-api] not configured — skipping reverse geocode');
    return null;
  }
  try {
    const response = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: 'system', content: REVERSE_SYSTEM_PROMPT },
        { role: 'user',   content: `Coordinates: lat=${lat}, lng=${lng}` },
      ],
      max_completion_tokens: 128,
    });
    const content = response.choices[0]?.message?.content?.trim() ?? null;
    if (!content || content === 'null') return null;
    const parsed = JSON.parse(content) as { country?: unknown; state?: unknown; place_name?: unknown };
    return {
      country:    typeof parsed.country    === 'string' ? parsed.country    : undefined,
      state:      typeof parsed.state      === 'string' ? parsed.state      : undefined,
      place_name: typeof parsed.place_name === 'string' ? parsed.place_name : undefined,
    };
  } catch (err) {
    console.error('[aoai-api] reverse geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
