/**
 * regeocodeAllPins.ts — re-runs all pins through the updated AOAI geocoding prompt.
 *
 * For each pin that has caption text (message content):
 *   1. Sends the caption through the current AOAI geocoding prompt.
 *   2. Compares new coordinates to existing coordinates using Haversine distance.
 *   3. Updates the pin in Cosmos DB only if the new location differs by more than
 *      DISTANCE_THRESHOLD_KM — indicating the improved prompt found a meaningfully
 *      different (presumably more accurate) location.
 *   4. Skips pins tagged as 'force-location' (intentionally overridden — don't touch).
 *   5. Skips pins with no caption (nothing to re-geocode).
 *   6. Never downgrades: if the new AOAI call returns null, the pin is left alone.
 *
 * Usage (from repo root):
 *   COSMOS_DB_ENDPOINT=... COSMOS_DB_KEY=... \
 *   AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... \
 *   AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini \
 *   npx tsx bot/scripts/regeocodeAllPins.ts
 *
 * Or via managed identity (production):
 *   COSMOS_DB_ENDPOINT=... AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini \
 *   npx tsx bot/scripts/regeocodeAllPins.ts
 */

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { geocodeWithText } from '../src/handlers/aoai.js';
import type { MapPin } from '../src/types/mapPin.js';

// Pins whose new coordinates differ by more than this are updated.
// 1 km covers normal rounding / centroid variation within the same place.
const DISTANCE_THRESHOLD_KM = 1.0;

// Pause between AOAI calls to avoid rate-limiting (ms)
const RATE_LIMIT_DELAY_MS = 500;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAllPins(): Promise<MapPin[]> {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  if (!endpoint) throw new Error('COSMOS_DB_ENDPOINT is required');
  const key = process.env.COSMOS_DB_KEY;
  const client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  const { resources } = await client
    .database('munchhatmap')
    .container('pins')
    .items.query<MapPin>('SELECT * FROM c ORDER BY c.createdAt ASC')
    .fetchAll();
  return resources;
}

async function updatePin(pin: MapPin): Promise<void> {
  const endpoint = process.env.COSMOS_DB_ENDPOINT!;
  const key = process.env.COSMOS_DB_KEY;
  const client = key
    ? new CosmosClient({ endpoint, key })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  await client.database('munchhatmap').container('pins').items.upsert(pin);
}

async function main(): Promise<void> {
  console.log('Fetching all pins from Cosmos DB…');
  const pins = await getAllPins();
  console.log(`Found ${pins.length} pins.\n`);

  let skippedForceLocation = 0;
  let skippedNoCaption = 0;
  let skippedSameLocation = 0;
  let skippedAoaiFailed = 0;
  let updated = 0;

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const prefix = `[${i + 1}/${pins.length}] ${pin.messageId}`;

    // Skip force-location pins — they were intentionally overridden
    if (pin.tagUsed === 'force-location') {
      console.log(`${prefix} — SKIP (force-location)`);
      skippedForceLocation++;
      continue;
    }

    // Skip pins with no caption text to send to AOAI
    if (!pin.caption?.trim()) {
      console.log(`${prefix} — SKIP (no caption)`);
      skippedNoCaption++;
      continue;
    }

    await sleep(RATE_LIMIT_DELAY_MS);

    const newLocation = await geocodeWithText(pin.caption);

    if (!newLocation) {
      console.log(`${prefix} — SKIP (AOAI returned null for: "${pin.caption.slice(0, 60)}")`);
      skippedAoaiFailed++;
      continue;
    }

    const distKm = haversineKm(pin.lat, pin.lng, newLocation.lat, newLocation.lng);

    if (distKm <= DISTANCE_THRESHOLD_KM) {
      console.log(
        `${prefix} — SKIP (${distKm.toFixed(2)} km — same location: ${pin.place_name ?? ''})`
      );
      skippedSameLocation++;
      continue;
    }

    // Meaningfully different result — update
    const oldDesc = `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)} "${pin.place_name ?? ''}"`;
    const newDesc = `${newLocation.lat.toFixed(4)},${newLocation.lng.toFixed(4)} "${newLocation.place_name ?? ''}"`;
    console.log(`${prefix} — UPDATE (${distKm.toFixed(1)} km)`);
    console.log(`  caption  : "${pin.caption.slice(0, 80)}"`);
    console.log(`  was      : ${oldDesc}`);
    console.log(`  now      : ${newDesc}`);

    await updatePin({
      ...pin,
      lat: newLocation.lat,
      lng: newLocation.lng,
      country: newLocation.country ?? pin.country,
      state: newLocation.state ?? pin.state,
      place_name: newLocation.place_name ?? pin.place_name,
    });
    updated++;
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Re-geocoding complete.

  Updated            : ${updated}
  Skipped — same location (< ${DISTANCE_THRESHOLD_KM} km) : ${skippedSameLocation}
  Skipped — force-location          : ${skippedForceLocation}
  Skipped — no caption              : ${skippedNoCaption}
  Skipped — AOAI returned null      : ${skippedAoaiFailed}
  Total processed                   : ${pins.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
