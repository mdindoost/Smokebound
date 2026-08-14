/**
 * All NWS access lives behind `NwsClient` (ARCHITECTURE §6.1).
 *
 * Tests use fixtures and never touch the network; the HTTP implementation is the
 * only thing in the codebase that knows api.weather.gov exists.
 *
 * Two failure modes are distinguished, and the difference matters:
 *  - `NwsUnavailableError` — 429/5xx/timeout. We are being throttled or NWS is
 *    down. Serve stale aggressively (REDTEAM F4).
 *  - `null` from `getForecast` — NWS has no data for that point at all (Canada,
 *    Mexico, offshore). Not an outage; nothing to retry. Fails open to clear.
 */

import type { LatLng } from '@smoke/shared';

export interface NwsForecast {
  /** e.g. "Chance Showers And Thunderstorms" */
  shortForecast: string;
  /** e.g. "10 to 15 mph" */
  windSpeed: string;
  /** e.g. "NW" */
  windDirection: string;
}

export interface NwsAlert {
  event: string;
  /** NWS CAP severity: Extreme | Severe | Moderate | Minor | Unknown */
  severity: string;
  /** Actual | Exercise | System | Test | Draft */
  status: string;
  /** Alert | Update | Cancel */
  messageType: string;
  ends?: string | null;
  expires?: string | null;
}

export interface NwsClient {
  /** Current-period forecast for a point, or null where NWS has no coverage. */
  getForecast(point: LatLng): Promise<NwsForecast | null>;
  /** Active alerts covering a point. Empty array when there are none. */
  getActiveAlerts(point: LatLng): Promise<NwsAlert[]>;
}

export class NwsUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'NwsUnavailableError';
  }

  /** True when NWS asked us to back off, rather than simply failing. */
  get isThrottled(): boolean {
    return this.status === 429;
  }
}

/**
 * A cell is impassable only while an *active severe warning or watch* covers it
 * (MECHANICS §2.1, REDTEAM F2). An ordinary thunderstorm forecast is 6.0× slow,
 * not a wall — that ruling is what keeps the summer Midwest traversable.
 */
export function isSevereAlert(alert: NwsAlert, now: Date = new Date()): boolean {
  if (alert.status !== 'Actual') return false;
  if (alert.messageType === 'Cancel') return false;
  if (!/warning|watch/i.test(alert.event)) return false;
  if (!/^(severe|extreme)$/i.test(alert.severity)) return false;

  const until = alert.ends ?? alert.expires;
  if (until) {
    const end = new Date(until);
    if (!Number.isNaN(end.getTime()) && end.getTime() <= now.getTime()) return false;
  }
  return true;
}

const NWS_BASE = 'https://api.weather.gov';

export interface HttpNwsClientOptions {
  /** NWS requires a contact in the User-Agent; they will block you without one. */
  userAgent: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Real NWS client. Gridpoint forecasts need two hops (`/points` → forecast URL),
 * so the `/points` lookup is memoised: the grid mapping for a coordinate never
 * changes, and it is the request we would otherwise repeat most.
 */
export class HttpNwsClient implements NwsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly forecastUrls = new Map<string, string | null>();

  constructor(private readonly options: HttpNwsClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? NWS_BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getForecast(point: LatLng): Promise<NwsForecast | null> {
    const forecastUrl = await this.resolveForecastUrl(point);
    if (forecastUrl === null) return null;

    const body = (await this.getJson(forecastUrl)) as {
      properties?: { periods?: NwsForecast[] };
    } | null;
    const period = body?.properties?.periods?.[0];
    if (!period) return null;

    return {
      shortForecast: period.shortForecast ?? '',
      windSpeed: period.windSpeed ?? '',
      windDirection: period.windDirection ?? '',
    };
  }

  async getActiveAlerts(point: LatLng): Promise<NwsAlert[]> {
    const url = `${this.baseUrl}/alerts/active?point=${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    const body = (await this.getJson(url)) as {
      features?: { properties?: NwsAlert }[];
    } | null;
    if (!body?.features) return [];
    return body.features.flatMap((f) => (f.properties ? [f.properties] : []));
  }

  private async resolveForecastUrl(point: LatLng): Promise<string | null> {
    const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    const cached = this.forecastUrls.get(key);
    if (cached !== undefined) return cached;

    const body = (await this.getJson(`${this.baseUrl}/points/${key}`)) as {
      properties?: { forecast?: string };
    } | null;
    const url = body?.properties?.forecast ?? null;
    this.forecastUrls.set(key, url);
    return url;
  }

  /** Returns null for 404 (no coverage); throws NwsUnavailableError otherwise. */
  private async getJson(url: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': this.options.userAgent,
          Accept: 'application/geo+json',
        },
        signal: controller.signal,
      });

      if (response.status === 404) return null; // outside NWS coverage
      if (!response.ok) {
        throw new NwsUnavailableError(`NWS ${response.status} for ${url}`, response.status);
      }
      return await response.json();
    } catch (err) {
      if (err instanceof NwsUnavailableError) throw err;
      throw new NwsUnavailableError(`NWS request failed for ${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
