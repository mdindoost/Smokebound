/**
 * The Ledger Report — nightly analytics (BETA.md §4).
 *
 *   npm run report            # to stdout
 *   npm run report -- --file  # also writes an email-ready copy
 *
 * BETA.md is specific about why this exists and what it must not be: decisions
 * come from the `events` table plus a thin layer, with **no third-party SDK in
 * v1** — a privacy posture and a review-simplicity argument at once. So this is
 * SQL against tables we already have, run on the home server, delivered to one
 * person. Nothing phones anywhere.
 *
 * It reads only aggregates and never message bodies. That is not squeamishness:
 * a report that quotes what people wrote is a report nobody can forward, and
 * this one is meant to be forwarded to The Aviary as a daily digest.
 *
 * Numbers that would mislead are labelled rather than dropped. A beta with four
 * users produces percentages that look like statistics and are not, so small
 * denominators are printed alongside every rate — the reader can then decide how
 * much to believe, which is the honest amount of help a report can give.
 */

import { connect } from './db.js';

interface Args {
  /** Also write an email-ready copy to disk. */
  toFile: boolean;
  /** How many days the report covers. */
  days: number;
}

function parseArgs(argv: readonly string[]): Args {
  const days = Number(argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 1);
  return {
    toFile: argv.includes('--file'),
    days: Number.isFinite(days) && days > 0 ? days : 1,
  };
}

const pad = (value: string | number, width: number): string => String(value).padEnd(width);
const rpad = (value: string | number, width: number): string => String(value).padStart(width);

/** A rate that admits how few things it is made of. */
function rate(part: number, whole: number): string {
  if (whole === 0) return '   —  (nobody yet)';
  const pct = Math.round((part / whole) * 100);
  return `${rpad(`${pct}%`, 5)}  (${part}/${whole})`;
}

function hours(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value < 1) return `${Math.round(value * 60)} min`;
  if (value < 48) return `${value.toFixed(1)} h`;
  return `${(value / 24).toFixed(1)} d`;
}

export async function buildReport(days: number): Promise<string> {
  const { db, close, target } = await connect();
  const lines: string[] = [];
  const say = (line = ''): void => void lines.push(line);

  try {
    const since = `now() - interval '${days} days'`;

    // ---- the activation funnel (BETA.md §4) -----------------------------
    // Install is not observable server-side — nothing exists until a profile
    // row does — so the funnel starts at onboarding and says so, rather than
    // inventing a denominator.
    const { rows: funnel } = await db.query<{
      onboarded: string;
      keeper_sent: string;
      keeper_delivered: string;
      real_sent: string;
    }>(`
      with people as (
        select id from public.profiles where is_system = false
      ),
      keeper as (
        select distinct m.sender from public.messages m
          join public.profiles p on p.id = m.recipient and p.is_system = true
      ),
      keeper_done as (
        select distinct m.sender from public.messages m
          join public.profiles p on p.id = m.recipient and p.is_system = true
         where m.state = 'DELIVERED'
      ),
      real_send as (
        select distinct m.sender from public.messages m
          join public.profiles p on p.id = m.recipient and p.is_system = false
      )
      select
        (select count(*) from people)::text as onboarded,
        (select count(*) from keeper)::text as keeper_sent,
        (select count(*) from keeper_done)::text as keeper_delivered,
        (select count(*) from real_send)::text as real_sent
    `);

    const f = funnel[0]!;
    const onboarded = Number(f.onboarded);

    say('THE LEDGER REPORT');
    say(`  ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` +
        `   ·   last ${days} day${days === 1 ? '' : 's'}   ·   ${target}`);
    say();
    say('ACTIVATION FUNNEL');
    say('  install → onboard is not observable server-side; the funnel starts where the data does.');
    say(`  onboarded            ${rpad(f.onboarded, 5)}`);
    say(`  sent to the Keeper   ${rpad(f.keeper_sent, 5)}   ${rate(Number(f.keeper_sent), onboarded)}`);
    say(`  Keeper delivered     ${rpad(f.keeper_delivered, 5)}   ${rate(Number(f.keeper_delivered), onboarded)}`);
    say(`  sent to a human      ${rpad(f.real_sent, 5)}   ${rate(Number(f.real_sent), onboarded)}`);

    // ---- per-message stats ----------------------------------------------
    const { rows: messages } = await db.query<{
      state: string;
      n: string;
      avg_route: string | null;
      avg_planned: string | null;
      avg_actual: string | null;
    }>(`
      select
        state,
        count(*)::text as n,
        avg(jsonb_array_length(coalesce(route, '[]'::jsonb)))::text as avg_route,
        avg(extract(epoch from (eta - departed_at)) / 3600)::text as avg_planned,
        avg(extract(epoch from (delivered_at - departed_at)) / 3600)::text as avg_actual
      from public.messages
      where created_at > ${since}
      group by state order by count(*) desc
    `);

    say();
    say('MESSAGES');
    if (messages.length === 0) say('  nothing sent in the window.');
    else {
      say(`  ${pad('state', 14)}${rpad('n', 5)}  ${rpad('cells', 7)}  ${rpad('planned', 9)}  ${rpad('actual', 9)}`);
      for (const row of messages) {
        say(
          `  ${pad(row.state, 14)}${rpad(row.n, 5)}  ` +
            `${rpad(row.avg_route ? Number(row.avg_route).toFixed(0) : '—', 7)}  ` +
            `${rpad(hours(row.avg_planned ? Number(row.avg_planned) : null), 9)}  ` +
            `${rpad(hours(row.avg_actual ? Number(row.avg_actual) : null), 9)}`,
        );
      }
    }

    // Planned vs actual is the tuning signal MECHANICS §8 cares about most:
    // it is the difference between the ETA we promised and the sky we got.
    const { rows: drift } = await db.query<{ n: string; avg_drift: string | null }>(`
      select count(*)::text as n,
             avg(extract(epoch from (delivered_at - eta)) / 60)::text as avg_drift
        from public.messages
       where state = 'DELIVERED' and delivered_at is not null and eta is not null
         and created_at > ${since}
    `);
    const d = drift[0]!;
    if (Number(d.n) > 0) {
      const minutes = Number(d.avg_drift ?? 0);
      say();
      say(
        `  ETA drift: ${minutes >= 0 ? '+' : ''}${minutes.toFixed(0)} min on average ` +
          `over ${d.n} delivered. Positive means later than promised.`,
      );
    }

    // ---- drama --------------------------------------------------------
    const { rows: strands } = await db.query<{
      stranded_messages: string;
      strand_events: string;
      avg_strand_hours: string | null;
      garble_events: string;
      lost: string;
    }>(`
      select
        (select count(distinct message_id)::text from public.events
          where kind = 'STRANDED' and created_at > ${since}) as stranded_messages,
        (select count(*)::text from public.events
          where kind = 'STRANDED' and created_at > ${since}) as strand_events,
        (select avg(extract(epoch from (now() - stranded_since)) / 3600)::text
           from public.messages where state = 'STRANDED') as avg_strand_hours,
        (select count(*)::text from public.events
          where kind = 'GARBLED' and created_at > ${since}) as garble_events,
        (select count(*)::text from public.messages
          where state = 'LOST' and created_at > ${since}) as lost
    `);
    const s = strands[0]!;
    say();
    say('DRAMA');
    say(`  messages that stranded    ${rpad(s.stranded_messages, 5)}   (${s.strand_events} strandings)`);
    say(`  currently sheltering for  ${rpad(hours(s.avg_strand_hours ? Number(s.avg_strand_hours) : null), 9)} on average`);
    say(`  gales that garbled        ${rpad(s.garble_events, 5)}`);
    say(`  lost to the sky           ${rpad(s.lost, 5)}`);

    // BETA.md §4's weather-luck check, computed rather than eyeballed.
    if (Number(s.strand_events) === 0) {
      say();
      say('  No strandings in the window. If this holds for a week the drama paths are');
      say('  going untested — see BETA.md §4 on the synthetic storm ("The Tempest"),');
      say('  which must be labelled in-app as a drill. Never fake weather silently.');
    }

    // ---- tower voices ---------------------------------------------------
    const { rows: voices } = await db.query<{ kind: string; n: string }>(`
      select kind, count(*)::text as n from public.events
       where kind in ('SIGHTED','WIND_ROSE','WIND_EASED','FOG_SET_IN','SKY_CLEARED')
         and created_at > ${since}
       group by kind order by count(*) desc
    `);
    if (voices.length > 0) {
      say();
      say('TOWER VOICES');
      for (const row of voices) say(`  ${pad(row.kind, 14)}${rpad(row.n, 5)}`);
    }

    // ---- the sky itself --------------------------------------------------
    const { rows: weather } = await db.query<{
      cells: string;
      fresh: string;
      unknown: string;
      impassable: string;
      oldest_minutes: string | null;
    }>(`
      select
        count(*)::text as cells,
        count(*) filter (where fetched_at > now() - interval '30 minutes')::text as fresh,
        count(*) filter (where weather_unknown)::text as unknown,
        count(*) filter (where impassable)::text as impassable,
        (extract(epoch from (now() - min(fetched_at))) / 60)::text as oldest_minutes
      from public.weather_cells
    `);
    const w = weather[0]!;
    say();
    say('THE SKY');
    say(`  cells known               ${rpad(w.cells, 5)}   (${w.fresh} fresh inside the TTL)`);
    say(`  fail-open / unknown       ${rpad(w.unknown, 5)}`);
    say(`  impassable right now      ${rpad(w.impassable, 5)}`);
    // ARCHITECTURE §6.1 asks for alert staleness as a standing metric: an
    // alerts outage un-walls the sky on purpose, and visible un-walling is the
    // acceptable kind.
    say(`  oldest observation        ${rpad(hours(w.oldest_minutes ? Number(w.oldest_minutes) / 60 : null), 9)} ago`);

    say();
    say('  Flight-view opens are not measured. There is no client analytics SDK in v1');
    say('  (BETA.md §4), and inventing a server-side proxy for engagement would be a');
    say('  number that looks like data. Ask testers instead.');
    say();

    return lines.join('\n');
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args.days);
  console.log(report);

  if (args.toFile) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const stamp = new Date().toISOString().slice(0, 10);
    mkdirSync('reports', { recursive: true });
    const path = `reports/ledger-${stamp}.txt`;
    writeFileSync(path, `${report}\n`, 'utf8');
    console.log(`written: ${path}`);
  }
}

// Only run when invoked directly, so the builder stays importable by tests.
if (process.argv[1]?.includes('ledgerReport')) {
  await main();
}
