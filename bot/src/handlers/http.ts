/**
 * http.ts — shared HTTP utility for the bot.
 *
 * Provides fetchWithTimeout() to prevent the bot from hanging indefinitely
 * when external services (Azure Maps, Discord CDN) are slow or unresponsive.
 */

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Wraps fetch() with an AbortController timeout.
 * Throws DOMException (AbortError) if the request exceeds timeoutMs.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}
