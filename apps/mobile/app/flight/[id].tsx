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
import { cellCenter, haversineKm, towerPhrase, towersAlong } from '@smoke/shared';

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
import { RouteLine, SmokeMarker, TowerMark, UnknownWeatherMark } from '../../src/map/SmokeTrail';
import { SkyPanel } from '../../src/map/SkyPanel';
import { stateBlurb, stateLabel } from '../../src/lib/copy';
import { formatDistance, formatEta, formatSince } from '../../src/lib/format';
import { flightAt, regionFor } from '../../src/lib/flight';
import { useSession } from '../../src/lib/session';
import type { CellWeatherView, ThreadMessageView } from '../../src/lib/gateway';

const TICK_MS = 2_000;

export default function Flight() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gateway } = useSession();

  const [message, setMessage] = useState<ThreadMessageView | null>(null);
  const [weather, setWeather] = useState<Map<string, CellWeatherView>>(new Map());
  const [radar, setRadar] = useState(true);
  const [showTowers, setShowTowers] = useState(true);
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
  const passed = towers.filter((tower) => snapshot.flown.includes(tower.cell));

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{message.direction === 'out' ? 'Your signal' : 'Their signal'}</Title>
        <StateChip label={stateLabel(message.state)} color={stateColor(message.state)} />
      </Row>

      <SkyPanel region={regionFor(route.length > 0 ? route : [message.originCell])} radar={radar} height={340}>
        <RouteLine flown={snapshot.flown} ahead={snapshot.ahead} />
        {showTowers &&
          towers.map((tower) => <TowerMark key={tower.cell} cell={tower.cell} name={tower.name} />)}
        {unknownCells.map((cell) => (
          <UnknownWeatherMark key={cell} cell={cell} />
        ))}
        <SmokeMarker snapshot={snapshot} state={message.state} />
      </SkyPanel>

      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" onPress={() => setRadar((on) => !on)}>
          <Caption tone="accent">{radar ? 'Radar on' : 'Radar off'}</Caption>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setShowTowers((on) => !on)}>
          <Caption tone="accent">{showTowers ? 'Towers on' : 'Towers off'}</Caption>
        </Pressable>
      </Row>

      <Card>
        <Body>{message.body ?? ''}</Body>
        <Small tone="faint">{stateBlurb(message.state)}</Small>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Distance</Small>
          <Mono>{formatDistance(distanceKm)}</Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">{message.state === 'DELIVERED' ? 'Arrived' : 'Arrives'}</Small>
          <Mono>
            {message.state === 'DELIVERED'
              ? formatEta(message.deliveredAt, now)
              : formatEta(message.eta, now)}
          </Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Progress</Small>
          <Mono>{Math.round(snapshot.progress * 100)}%</Mono>
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
            <Small>{eventLine(event.kind, event.payload)}</Small>
            <Caption>{formatSince(event.at, now)}</Caption>
          </Row>
        ))}
        {passed.map((tower) => (
          <Small key={tower.cell} tone="faint">
            passed the {tower.name} tower
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

function eventLine(kind: string, payload: Record<string, unknown> | null): string {
  const cell = typeof payload?.['cell'] === 'string' ? (payload['cell'] as string) : null;
  const tower = cell === null ? null : towerPhrase(cell);

  switch (kind) {
    case 'SENT':
      return 'You lit the fire.';
    case 'DEPARTED':
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
