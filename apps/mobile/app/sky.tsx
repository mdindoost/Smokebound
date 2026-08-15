/**
 * The Sky — home (ARCHITECTURE §7.1).
 *
 * Your signals in the air, on a dark panel, with the weather they are dodging.
 * Tap one to follow it.
 *
 * A note on "your flock's smoke": RLS hides an undelivered message from its
 * recipient entirely (ARCHITECTURE §3, SPEC §4.4), so the only smoke anyone can
 * see is their own. That is the product, not a limitation of this screen — see
 * the M5 note in the README.
 */

import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Row,
  Screen,
  Small,
  StateChip,
  Title,
} from '../src/design/components';
import { sky } from '../src/design/sky';
import { spacing, stateColor } from '../src/design/tokens';
import { RouteLine, SmokeMarker } from '../src/map/SmokeTrail';
import { MapToggle } from '../src/map/MapToggle';
import { SkyPanel } from '../src/map/SkyPanel';
import { stateLabel } from '../src/lib/copy';
import { formatEta } from '../src/lib/format';
import { flightAt, regionFor } from '../src/lib/flight';
import { useSession } from '../src/lib/session';
import type { ThreadMessageView } from '../src/lib/gateway';

/** How often the smoke's position is recomputed. Cosmetic only. */
const TICK_MS = 5_000;

export default function Sky() {
  const { gateway, profile } = useSession();
  const [messages, setMessages] = useState<ThreadMessageView[]>([]);
  const [radar, setRadar] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = (): void => {
        void gateway.inFlight().then((rows) => {
          if (alive) setMessages(rows);
        });
      };
      load();
      const poll = setInterval(load, 30_000);
      return () => {
        alive = false;
        clearInterval(poll);
      };
    }, [gateway]),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const mine = useMemo(
    () => messages.filter((message) => message.direction === 'out'),
    [messages],
  );

  const framed = useMemo(() => {
    const cells = mine.flatMap((message) => message.route ?? [message.originCell]);
    // With nothing in the air, frame the user's own fire rather than the whole
    // country — an empty continent is a worse answer than "here is your hill".
    return cells.length > 0 ? cells : profile?.homeCell ? [profile.homeCell] : [];
  }, [mine, profile?.homeCell]);

  const region = useMemo(() => regionFor(framed), [framed]);
  const regionKey = useMemo(() => framed.join(','), [framed]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>The Sky</Title>
        <MapToggle label="Radar" on={radar} onPress={() => setRadar((v) => !v)} />
      </Row>

      <SkyPanel region={region} regionKey={regionKey} radar={radar} height={360}>
        {mine.map((message) => {
          const snapshot = flightAt(
            {
              state: message.state,
              route: message.route,
              segmentEtas: message.segmentEtas,
              departedAt: message.departedAt,
              eta: message.eta,
              strandedCell: message.strandedCell,
              lostCell: message.lostCell,
            },
            now,
          );
          return (
            <View key={message.id}>
              <RouteLine flown={snapshot.flown} ahead={snapshot.ahead} />
              <SmokeMarker
                snapshot={snapshot}
                state={message.state}
                onPress={() => router.push(`/flight/${message.id}`)}
              />
            </View>
          );
        })}
      </SkyPanel>

      {mine.length === 0 ? (
        <EmptyState
          title="Nothing in the air"
          body="Light a fire and watch it cross the map. The Keeper is one hill away and always answers."
          action={<Button label="Light a fire" onPress={() => router.push('/compose')} />}
        />
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {mine.map((message, index) => (
            <Pressable
              key={message.id}
              accessibilityRole="button"
              onPress={() => router.push(`/flight/${message.id}`)}
              style={{
                padding: spacing.lg,
                gap: spacing.xs,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: sky.line,
              }}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <Body numberOfLines={1} style={{ flex: 1 }}>
                  {message.body ?? ''}
                </Body>
                <StateChip label={stateLabel(message.state)} color={stateColor(message.state)} />
              </Row>
              <Small tone="faint">
                {message.state === 'STRANDED'
                  ? 'Sheltering at the edge of a storm.'
                  : // The Sky shows only what you sent, so the arrival is theirs.
                    `They receive it ${formatEta(message.eta, now)}`}
              </Small>
            </Pressable>
          ))}
        </Card>
      )}

      <Row style={{ justifyContent: 'space-between' }}>
        <Link href="/ledger">
          <Small tone="accent">The Ledger</Small>
        </Link>
        <Link href="/flock">
          <Small tone="faint">Flock</Small>
        </Link>
        <Link href="/settings">
          <Small tone="faint">Settings</Small>
        </Link>
      </Row>
    </Screen>
  );
}
