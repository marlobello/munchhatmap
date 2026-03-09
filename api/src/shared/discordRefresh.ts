/**
 * Refreshes expiring Discord CDN attachment URLs via Discord's refresh-urls API.
 *
 * Discord CDN URLs include time-limited signatures (ex=, is=, hm= query params).
 * This module batch-refreshes them and caches results to avoid redundant API calls.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const BATCH_SIZE = 50;
const CACHE_TTL_MS = 11 * 60 * 60 * 1000; // 11 hours (Discord URLs typically expire in ~24h)

interface CacheEntry {
  refreshedUrl: string;
  cachedAt: number;
}

/** Module-level cache: attachment path → refreshed URL + timestamp */
const _cache = new Map<string, CacheEntry>();

/**
 * Extracts the path portion of a Discord CDN URL for use as a stable cache key
 * (the query params change on every refresh, but the path is stable per attachment).
 */
function cacheKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Returns true if the URL is a Discord CDN URL that has expiry params and may need refreshing.
 */
function isDiscordCdnUrl(url: string): boolean {
  return (url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net'))
    && url.includes('ex=');
}

/**
 * Refreshes an array of Discord CDN URLs, returning a Map of original → refreshed URL.
 * URLs that are not Discord CDN URLs (or have no expiry params) are returned unchanged.
 * Falls back to the original URL on any error.
 */
export async function refreshDiscordUrls(urls: string[]): Promise<Map<string, string>> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const result = new Map<string, string>();
  const now = Date.now();

  if (!token) {
    for (const url of urls) result.set(url, url);
    return result;
  }

  const toRefresh: string[] = [];

  for (const url of urls) {
    if (!isDiscordCdnUrl(url)) {
      result.set(url, url);
      continue;
    }
    const key = cacheKey(url);
    const cached = _cache.get(key);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      result.set(url, cached.refreshedUrl);
    } else {
      toRefresh.push(url);
    }
  }

  // Batch refresh uncached / expired-cache URLs
  for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
    const batch = toRefresh.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(`${DISCORD_API}/attachments/refresh-urls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ attachment_urls: batch }),
      });
      if (response.ok) {
        const data = await response.json() as {
          refreshed_urls: { original: string; refreshed: string }[];
        };
        for (const { original, refreshed } of data.refreshed_urls) {
          _cache.set(cacheKey(original), { refreshedUrl: refreshed, cachedAt: now });
          result.set(original, refreshed);
        }
      } else {
        console.error(`[discordRefresh] API returned ${response.status} — using original URLs`);
        for (const url of batch) result.set(url, url);
      }
    } catch (err) {
      console.error('[discordRefresh] fetch failed:', err instanceof Error ? err.message : err);
      for (const url of batch) result.set(url, url);
    }
  }

  return result;
}
