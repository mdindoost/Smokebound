/**
 * NWS client behaviour. The HTTP implementation is exercised with a stub
 * `fetch` — no test in this repo ever touches api.weather.gov.
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpNwsClient, NwsUnavailableError, isSevereAlert } from '../../src/weather/nws.js';
import type { NwsAlert } from '../../src/weather/nws.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function alert(patch: Partial<NwsAlert> = {}): NwsAlert {
  return {
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    status: 'Actual',
    messageType: 'Alert',
    ends: '2026-08-14T18:00:00.000Z',
    ...patch,
  };
}

describe('isSevereAlert (MECHANICS §2.1, REDTEAM F2)', () => {
  it('accepts an active severe warning', () => {
    expect(isSevereAlert(alert(), NOW)).toBe(true);
  });

  it('accepts watches as well as warnings', () => {
    expect(isSevereAlert(alert({ event: 'Tornado Watch' }), NOW)).toBe(true);
  });

  it('accepts extreme severity', () => {
    expect(isSevereAlert(alert({ event: 'Hurricane Warning', severity: 'Extreme' }), NOW)).toBe(
      true,
    );
  });

  it('rejects advisories and statements — they are not walls', () => {
    expect(isSevereAlert(alert({ event: 'Heat Advisory', severity: 'Moderate' }), NOW)).toBe(false);
    expect(
      isSevereAlert(alert({ event: 'Special Weather Statement', severity: 'Moderate' }), NOW),
    ).toBe(false);
  });

  it('rejects a moderate-severity warning', () => {
    // Ordinary thunderstorms are 6.0x slow and passable, not impassable.
    expect(isSevereAlert(alert({ event: 'Flood Warning', severity: 'Moderate' }), NOW)).toBe(false);
  });

  it('rejects tests, exercises and cancellations', () => {
    expect(isSevereAlert(alert({ status: 'Test' }), NOW)).toBe(false);
    expect(isSevereAlert(alert({ status: 'Exercise' }), NOW)).toBe(false);
    expect(isSevereAlert(alert({ messageType: 'Cancel' }), NOW)).toBe(false);
  });

  it('rejects an alert that has already ended', () => {
    expect(isSevereAlert(alert({ ends: '2026-08-14T06:00:00.000Z' }), NOW)).toBe(false);
    expect(isSevereAlert(alert({ ends: null, expires: '2026-08-14T06:00:00.000Z' }), NOW)).toBe(
      false,
    );
  });

  it('accepts an alert with no end time', () => {
    expect(isSevereAlert(alert({ ends: null, expires: null }), NOW)).toBe(true);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/geo+json' },
  });
}

const POINT = { lat: 40.75, lng: -74.0 };

describe('HttpNwsClient', () => {
  it('resolves a gridpoint forecast in two hops and identifies itself', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/points/')) {
        return jsonResponse({ properties: { forecast: 'https://api.weather.gov/gridpoints/OKX/1,2/forecast' } });
      }
      return jsonResponse({
        properties: {
          periods: [{ shortForecast: 'Chance Showers And Thunderstorms', windSpeed: '10 to 15 mph', windDirection: 'SW' }],
        },
      });
    });

    const client = new HttpNwsClient({ userAgent: '(smoke, dev@example.com)', fetchImpl: fetchImpl as unknown as typeof fetch });
    const forecast = await client.getForecast(POINT);

    expect(forecast).toEqual({
      shortForecast: 'Chance Showers And Thunderstorms',
      windSpeed: '10 to 15 mph',
      windDirection: 'SW',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('smoke');
  });

  it('memoises the /points lookup — the grid mapping never changes', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/points/')
        ? jsonResponse({ properties: { forecast: 'https://example.test/forecast' } })
        : jsonResponse({ properties: { periods: [{ shortForecast: 'Sunny', windSpeed: '5 mph', windDirection: 'N' }] } }),
    );

    const client = new HttpNwsClient({ userAgent: 'x', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.getForecast(POINT);
    await client.getForecast(POINT);

    const pointCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/points/'));
    expect(pointCalls).toHaveLength(1);
  });

  it('returns null where NWS has no coverage, rather than failing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
    const client = new HttpNwsClient({ userAgent: 'x', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getForecast({ lat: 49.2, lng: -123.1 })).resolves.toBeNull();
  });

  it('raises NwsUnavailableError on server errors, flagging throttling', async () => {
    const client500 = new HttpNwsClient({
      userAgent: 'x',
      fetchImpl: (async () => jsonResponse({}, 503)) as unknown as typeof fetch,
    });
    await expect(client500.getForecast(POINT)).rejects.toBeInstanceOf(NwsUnavailableError);

    const client429 = new HttpNwsClient({
      userAgent: 'x',
      fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
    });
    await client429
      .getForecast(POINT)
      .then(() => expect.unreachable('should have thrown'))
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(NwsUnavailableError);
        expect((err as NwsUnavailableError).isThrottled).toBe(true);
      });
  });

  it('turns a network failure into NwsUnavailableError, not a raw crash', async () => {
    const client = new HttpNwsClient({
      userAgent: 'x',
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    await expect(client.getForecast(POINT)).rejects.toBeInstanceOf(NwsUnavailableError);
  });

  it('reads every active alert in one request (REDTEAM F19)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        features: [
          { properties: alert() },
          { properties: alert({ event: 'Heat Advisory', severity: 'Moderate' }) },
        ],
      }),
    );
    const client = new HttpNwsClient({ userAgent: 'x', fetchImpl: fetchImpl as unknown as typeof fetch });
    const alerts = await client.getActiveAlerts();

    expect(alerts).toHaveLength(2);
    expect(alerts.filter((a) => isSevereAlert(a, NOW))).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/alerts/active?status=actual');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('carries alert geometry through, so cells can be matched locally', async () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-75, 40],
          [-73, 40],
          [-73, 42],
          [-75, 42],
          [-75, 40],
        ],
      ],
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ features: [{ properties: alert(), geometry }] }),
    );
    const client = new HttpNwsClient({ userAgent: 'x', fetchImpl: fetchImpl as unknown as typeof fetch });
    const [first] = await client.getActiveAlerts();
    expect(first!.geometry).toEqual(geometry);
  });

  it('reports a null geometry rather than dropping the alert', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ features: [{ properties: alert({ event: 'Tornado Watch' }), geometry: null }] }),
    );
    const client = new HttpNwsClient({ userAgent: 'x', fetchImpl: fetchImpl as unknown as typeof fetch });
    const [first] = await client.getActiveAlerts();
    expect(first!.geometry).toBeNull();
    expect(first!.event).toBe('Tornado Watch');
  });
});
