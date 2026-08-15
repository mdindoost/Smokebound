/**
 * The flight view (ARCHITECTURE §7.3).
 *
 * One message, its route, where the smoke is now, and the ledger of everything
 * that has happened to it. The position is interpolated client-side from the
 * server's segment ETAs and is **cosmetic only** — every state word on this
 * screen comes from the server.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  cellCenter,
  displayPoint,
  haversineKm,
  towerNameFor,
  towerPhrase,
  towersAlong,
} from '@smoke/shared';

import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Mono,
  Row,
  Screen,
  Small,
  StateChip,
  Title,
} from '../../src/design/components';
import { sky } from '../../src/design/sky';
import { spacing, stateColor } from '../../src/design/tokens';
import {
  RouteLine,
  SmokeMarker,
  TerminatorLine,
  TowerMark,
  UnknownWeatherMark,
} from '../../src/map/SmokeTrail';
import { MapToggle } from '../../src/map/MapToggle';
import { marksForZoom, thinTowers } from '../../src/map/towerDensity';
import { BreathingEmber } from '../../src/map/BreathingEmber';
import { NightChain } from '../../src/map/NightChain';
import { chainFor } from '../../src/map/chain';
import { emberRadiusFor } from '../../src/design/motion';
import { SkyPanel } from '../../src/map/SkyPanel';
import { arrivalLabel, stateBlurb, stateLabel } from '../../src/lib/copy';
import { formatDistance, formatEta, formatSince } from '../../src/lib/format';
import { confirmedCells, flightAt, pathOf, regionFor } from '../../src/lib/flight';
import { crossingsAlong } from '../../src/lib/crossings';
import { towerVoice } from '../../src/lib/towerVoice';
import { windReading } from '../../src/lib/wind';
import { regimeAt, regimeInCell, regimeLine, terminatorPath } from '../../src/map/NightLayer';
import { useSession } from '../../src/lib/session';
import type { CellWeatherView, MechanicsView, ThreadMessageView } from '../../src/lib/gateway';

const TICK_MS = 2_000;

export default function Flight() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gateway } = useSession();

  const [message, setMessage] = useState<ThreadMessageView | null>(null);
  const [weather, setWeather] = useState<Map<string, CellWeatherView>>(new Map());
  const [radar, setRadar] = useState(true);
  const [mechanics, setMechanics] = useState<MechanicsView | null>(null);
  const [showTowers, setShowTowers] = useState(true);
  const [zoom, setZoom] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const found = await gateway.message(id);
    setMessage(found);
    if (found?.route) setWeather(await gateway.cellWeather(found.route));
  }, [gateway, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const poll = setInterval(() => void load(), 30_000);
      return () => clearInterval(poll);
    }, [load]),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // The night flags and the twilight threshold come from mechanics_config like
  // every other number — the client never decides what dusk is.
  useEffect(() => {
    void gateway.mechanics().then(setMechanics).catch(() => setMechanics(null));
  }, [gateway]);

  const snapshot = useMemo(
    () =>
      flightAt(
        {
          state: message?.state ?? 'TRANSMITTING',
          route: message?.route ?? null,
          segmentEtas: message?.segmentEtas ?? null,
          departedAt: message?.departedAt ?? null,
          eta: message?.eta ?? null,
          strandedCell: message?.strandedCell ?? null,
          lostCell: message?.lostCell ?? null,
        },
        now,
      ),
    [message, now],
  );

  const towers = useMemo(() => towersAlong(message?.route ?? []), [message?.route]);
  // The map gets a thinned set; the Ledger below keeps every one. A sixty-cell
  // route draws sixty marks that tile into a solid band over the route line.
  const mapTowers = useMemo(() => thinTowers(towers, marksForZoom(zoom)), [towers, zoom]);
  // What the smoke is flying through at this moment — the question the flight
  // view should always answer without being asked.
  // What the tower is burning where the smoke is, right now (REDTEAM F32).
  // Theater: shown whenever night.visuals_enabled, whatever the mechanic does.
  // Cells the *engine* has confirmed. The chain, and the regime that chooses
  // between chain and drifting marker, are both anchored here — never on the
  // interpolated position (DESIGN.md V7, M5.7 handoff rule).
  const confirmed = useMemo(
    () =>
      message === null
        ? []
        : confirmedCells(
            message.route ?? [],
            message.currentLeg,
            message.state,
            message.departedAt,
          ),
    [message],
  );

  const regime = useMemo(() => {
    if (mechanics === null) return 'smoke';
    const anchor = confirmed.at(-1) ?? message?.originCell ?? null;
    if (anchor === null) return 'smoke';
    return regimeInCell(now, anchor, mechanics.twilightElevationDeg, mechanics.nightVisuals);
  }, [confirmed, message?.originCell, now, mechanics]);

  // At night the towers are the signal, so the whole route chain renders —
  // R22's thinning is a daytime rule about labels (M5.7).
  const chain = useMemo(
    () => (regime === 'fire' ? chainFor(message?.route ?? [], confirmed) : []),
    [regime, message?.route, confirmed],
  );
  const blazing = useMemo(() => chain.find((link) => link.phase === 'current') ?? null, [chain]);

  const panelRegion = useMemo(() => {
    const cells = message?.route ?? (message ? [message.originCell] : []);
    return regionFor(cells);
  }, [message?.route, message?.originCell]);

  const terminator = useMemo(() => {
    if (mechanics === null || !mechanics.nightVisuals) return [];
    return terminatorPath(now, mechanics.twilightElevationDeg, {
      minLat: panelRegion.latitude - panelRegion.latitudeDelta / 2,
      maxLat: panelRegion.latitude + panelRegion.latitudeDelta / 2,
      minLng: panelRegion.longitude - panelRegion.longitudeDelta / 2,
      maxLng: panelRegion.longitude + panelRegion.longitudeDelta / 2,
    });
  }, [mechanics, now, panelRegion]);

  // Sunsets and sunrises the smoke has actually flown through. Derived, not
  // stored — but only for legs the engine has confirmed (DESIGN.md V7).
  const crossings = useMemo(
    () =>
      message === null || mechanics === null || !mechanics.nightVisuals
        ? []
        : crossingsAlong(
            message.segmentEtas,
            confirmedCells(
              message.route ?? [],
              message.currentLeg,
              message.state,
              message.departedAt,
            ),
            mechanics.twilightElevationDeg,
          ),
    [message, mechanics],
  );

  const conditions = useMemo(
    () =>
      message?.state === 'IN_FLIGHT' || message?.state === 'STRANDED'
        ? windReading(message.route ?? [], snapshot.leg, weather)
        : null,
    [message?.state, message?.route, snapshot.leg, weather],
  );
  const unknownCells = useMemo(
    () => (message?.route ?? []).filter((cell) => weather.get(cell)?.weatherUnknown === true),
    [message?.route, weather],
  );

  if (message === null) {
    return (
      <Screen>
        <Small tone="faint">Reading the sky…</Small>
      </Screen>
    );
  }

  if (message.state === 'LOST') {
    router.replace(`/loss/${message.id}`);
    return null;
  }

  const route = message.route ?? [];
  const distanceKm = haversineKm(cellCenter(message.originCell), cellCenter(message.destCell));
  // The departure event already says "The smoke rose from the Little Falls
  // tower"; listing "passed the Little Falls tower" underneath it is the same
  // fact told twice, in a weaker voice. And the list is drawn from the engine's
  // `current_leg`, not from interpolation — a tower we merely calculate the
  // smoke to be past has not been passed.
  const departureTower = towerNameFor(message.originCell);
  const passed = towers.filter(
    (tower) => confirmed.includes(tower.cell) && tower.name !== departureTower,
  );

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{message.direction === 'out' ? 'Your signal' : 'Their signal'}</Title>
        <StateChip label={stateLabel(message.state)} color={stateColor(message.state)} />
      </Row>

      <SkyPanel
        region={panelRegion}
        regionKey={route.join(',')}
        fitTo={pathOf(route.length > 0 ? route : [message.originCell])}
        onZoomChange={setZoom}
        radar={radar}
        height={340}
      >
        {terminator.length > 1 && <TerminatorLine points={terminator} />}
        <RouteLine flown={snapshot.flown} ahead={snapshot.ahead} />
        {showTowers && regime === 'fire' && <NightChain links={chain} zoom={zoom} />}
        {showTowers &&
          regime === 'smoke' &&
          mapTowers.map((tower) => (
            <TowerMark
              key={tower.cell}
              cell={tower.cell}
              name={tower.name}
              passed={snapshot.flown.includes(tower.cell)}
            />
          ))}
        {unknownCells.map((cell) => (
          <UnknownWeatherMark key={cell} cell={cell} />
        ))}
        {/* The breath sits on whatever is currently carrying the signal: the
            blazing tower after dark, the drifting smoke by day. */}
        {message.state === 'IN_FLIGHT' && (
          <BreathingEmber
            at={regime === 'fire' ? (blazing ? displayPoint(blazing.cell) : null) : snapshot.position}
            baseRadiusMeters={emberRadiusFor(zoom)}
            regime={regime}
          />
        )}
        {/* Fire does not drift (M5.7): after dark the chain is the position, and
            a travelling dot on top of it would say the same thing wrongly. */}
        {regime === 'smoke' && (
          <SmokeMarker snapshot={snapshot} state={message.state} regime={regime} />
        )}
      </SkyPanel>

      <Row style={{ justifyContent: 'space-between' }}>
        <MapToggle label="Radar" on={radar} onPress={() => setRadar((v) => !v)} />
        <MapToggle label="Towers" on={showTowers} onPress={() => setShowTowers((v) => !v)} />
      </Row>

      <Card>
        <Body>{message.body ?? ''}</Body>
        <Small tone="faint">{stateBlurb(message.state, snapshot.awaitingConfirmation, regime)}</Small>
        {regime === 'fire' && mechanics !== null && (
          <Small tone="faint">{regimeLine(regime, mechanics.nightMechanics)}</Small>
        )}
        {conditions !== null && (
          <Small tone={conditions.adverse ? 'soft' : 'faint'}>{conditions.line}</Small>
        )}
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Distance</Small>
          <Mono>{formatDistance(distanceKm)}</Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">
            {arrivalLabel(message.direction, message.state === 'DELIVERED')}
          </Small>
          <Mono>
            {message.state === 'DELIVERED'
              ? formatEta(message.deliveredAt, now)
              : formatEta(message.eta, now)}
          </Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Progress</Small>
          {/* "100%" beside an IN FLIGHT chip is the client overruling the
              server. Once the arithmetic runs out, the honest reading is that
              we are waiting, not that we are done. */}
          <Mono>
            {snapshot.awaitingConfirmation ? 'Arriving' : `${Math.round(snapshot.progress * 100)}%`}
          </Mono>
        </Row>
        {unknownCells.length > 0 && (
          <Small tone="faint">
            {unknownCells.length === 1
              ? '1 cell on this route has no forecast — we are assuming clear skies there.'
              : `${unknownCells.length} cells on this route have no forecast — we are assuming clear skies there.`}
          </Small>
        )}
      </Card>

      {message.state === 'STRANDED' && (
        <Banner tone="info">
          <Caption style={{ color: sky.sheltering }}>Sheltering</Caption>
          <Small tone="soft">
            The way ahead is closed. Your smoke is waiting at the storm's edge
            {message.strandedCell !== null ? ` — ${towerPhrase(message.strandedCell) ?? 'out there'}` : ''}.
            It moves again the moment the sky does.
          </Small>
        </Banner>
      )}

      <Card>
        <Caption>The ledger</Caption>
        {message.events.map((event) => (
          <Row key={`${event.kind}-${event.at}`} style={{ justifyContent: 'space-between' }}>
            <Small>
              {eventLine(
                event.kind,
                event.payload,
                mechanics === null
                  ? 'smoke'
                  : regimeAtEvent(event, mechanics.twilightElevationDeg, mechanics.nightVisuals),
                event.at,
              )}
            </Small>
            <Caption>{formatSince(event.at, now)}</Caption>
          </Row>
        ))}
        {passed.map((tower) => (
          <Small key={tower.cell} tone="faint">
            passed the {tower.name} tower
          </Small>
        ))}
        {crossings.map((crossing) => (
          <Small key={`${crossing.cell}-${crossing.at}`} tone="faint">
            {crossing.line}
          </Small>
        ))}
      </Card>

      <Button
        label="Back to the sky"
        variant="ghost"
        onPress={() => router.push('/sky')}
      />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/** What the sky was doing where and when an event happened (M5.7). */
function regimeAtEvent(
  event: { at: string; payload: Record<string, unknown> | null },
  twilightElevationDeg: number,
  visualsEnabled: boolean,
): 'smoke' | 'fire' {
  const cell = typeof event.payload?.['cell'] === 'string' ? (event.payload['cell'] as string) : null;
  if (cell === null) return 'smoke';
  const at = new Date(event.at);
  if (Number.isNaN(at.getTime())) return 'smoke';
  return regimeInCell(at, cell, twilightElevationDeg, visualsEnabled);
}

/**
 * One line of the Ledger.
 *
 * Keyed on the regime *at the time of the event*, not now (M5.7). A message that
 * left at dusk and arrives at noon should read as a fire kindled and a smoke
 * delivered, because that is what happened — the Ledger is a record, and a
 * record written in this evening's vocabulary is a record of the wrong evening.
 */
function eventLine(
  kind: string,
  payload: Record<string, unknown> | null,
  regime: 'smoke' | 'fire' = 'smoke',
  at = '',
): string {
  // Tower voices speak for themselves where they have something to say (§2).
  const voice = towerVoice({ kind, at, payload });
  if (voice !== null) return voice;

  const cell = typeof payload?.['cell'] === 'string' ? (payload['cell'] as string) : null;
  const tower = cell === null ? null : towerPhrase(cell);

  switch (kind) {
    case 'SENT':
      return 'You lit the fire.';
    case 'DEPARTED':
      if (regime === 'fire') {
        return tower === null
          ? 'The fire was kindled.'
          : `The fire was kindled at ${tower}.`;
      }
      return tower === null ? 'The smoke rose.' : `The smoke rose from ${tower}.`;
    case 'STRANDED':
      return tower === null
        ? 'Sheltering from a storm.'
        : `Sheltering from a storm at ${tower}.`;
    case 'RESUMED':
      return 'The skies cleared. Moving again.';
    case 'GARBLED':
      return tower === null ? 'A gale tore at the message.' : `A gale tore at it near ${tower}.`;
    case 'DELIVERED':
      return 'It arrived.';
    case 'LOST':
      return 'The sky took it.';
    default:
      return kind;
  }
}
