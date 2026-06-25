/**
 * telemetry.ts — thin wrapper around Application Insights custom telemetry.
 *
 * Uses a standalone TelemetryClient (no auto-collection setup) so it does NOT
 * duplicate the request/dependency tracking the Azure Functions host already
 * performs when APPLICATIONINSIGHTS_CONNECTION_STRING is set. It only adds the
 * custom events, metrics, and exceptions emitted by our handlers.
 *
 * If the connection string is not configured (e.g. local dev), every call is a
 * no-op so handlers never need to guard their telemetry calls.
 */

import appInsights from 'applicationinsights';

let _client: appInsights.TelemetryClient | null = null;
let _initialised = false;

function getClient(): appInsights.TelemetryClient | null {
  if (_initialised) return _client;
  _initialised = true;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return null;

  try {
    _client = new appInsights.TelemetryClient(connectionString);
  } catch {
    _client = null;
  }
  return _client;
}

/** Records a custom event (App Insights `customEvents` table). */
export function trackEvent(name: string, properties?: Record<string, string>): void {
  getClient()?.trackEvent({ name, properties });
}

/** Records a custom metric (App Insights `customMetrics` table). */
export function trackMetric(name: string, value: number, properties?: Record<string, string>): void {
  getClient()?.trackMetric({ name, value, properties });
}

/** Records an exception (App Insights `exceptions` table). */
export function trackException(error: unknown, properties?: Record<string, string>): void {
  const exception = error instanceof Error ? error : new Error(String(error));
  getClient()?.trackException({ exception, properties });
}
