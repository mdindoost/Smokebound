/**
 * Are the third-party services we draw from actually there?
 *
 *   npm run check:endpoints
 *
 * SMOKE depends on two public NOAA services it does not control, and both fail
 * quietly: the weather API degrades to fail-open (calm skies everywhere), and a
 * broken radar layer renders an attribution bar over nothing. Neither shows up
 * in the test suite, because a unit test can only check the shape of a URL —
 * and a URL of exactly the right shape pointing at a service that has been
 * retired is precisely the bug this script exists to catch. It did in fact
 * ship: the radar layer was live against a 404 until someone looked at a phone.
 *
 * Deliberately not part of `npm test`. A red build should mean our code is
 * wrong, never that NOAA is having an afternoon.
 */

const CHECKS = [
  {
    name: 'NWS forecast API (engine: weather multipliers)',
    url: 'https://api.weather.gov/points/40.78,-74.20',
    headers: { 'User-Agent': process.env['NWS_USER_AGENT'] ?? '(smoke, contact@example.com)' },
    ok: (res, body) => res.ok && body.includes('forecastGridData'),
  },
  {
    name: 'NWS active alerts (engine: gale + storm events)',
    url: 'https://api.weather.gov/alerts/active?area=NJ',
    headers: { 'User-Agent': process.env['NWS_USER_AGENT'] ?? '(smoke, contact@example.com)' },
    ok: (res, body) => res.ok && body.includes('"features"'),
  },
  {
    name: 'NOAA radar WMS (app: The Sky radar layer)',
    url:
      'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows' +
      '?service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd' +
      '&bbox=-8293666,4944686,-8226864,5018658&width=64&height=64' +
      '&srs=EPSG:3857&format=image/png&transparent=true',
    // An ArcGIS 404 is served as HTML with a 200-shaped body in some proxies,
    // so insist on the content type rather than trusting the status alone.
    ok: (res) => res.ok && (res.headers.get('content-type') ?? '').startsWith('image/'),
  },
];

let failed = 0;

for (const check of CHECKS) {
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      headers: check.headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = check.ok.length > 1 ? await res.text() : '';
    const ms = Date.now() - started;
    if (check.ok(res, body)) {
      console.log(`  ok    ${check.name}  (${res.status}, ${ms}ms)`);
    } else {
      failed += 1;
      console.log(
        `  FAIL  ${check.name}\n        ${res.status} ${res.headers.get('content-type')}\n        ${check.url}`,
      );
    }
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${check.name}\n        ${String(error)}\n        ${check.url}`);
  }
}

console.log(
  failed === 0
    ? '\nAll upstream services reachable.'
    : `\n${failed} of ${CHECKS.length} unreachable. The app degrades rather than crashing, but the sky will be wrong.`,
);
process.exit(failed === 0 ? 0 : 1);
