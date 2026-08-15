/**
 * The loss screen (SPEC §4.5, §6.4).
 *
 * "The sky took this one. 412 miles from home." A memorial, not an error
 * dialog — elegiac state semantics (DESIGN.md V4). It says where it died and
 * why, and offers the only reasonable response: light a new fire.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { cellCenter, haversineKm, towerPhrase } from '@smoke/shared';

import {
  Body,
  Button,
  Caption,
  Card,
  Display,
  Mono,
  Row,
  Screen,
  Small,
} from '../../src/design/components';
import { sky } from '../../src/design/sky';
import { RouteLine, SmokeMarker } from '../../src/map/SmokeTrail';
import { SkyPanel } from '../../src/map/SkyPanel';
import { formatDistance, formatSince } from '../../src/lib/format';
import { flightAt, regionFor } from '../../src/lib/flight';
import { useSession } from '../../src/lib/session';
import type { ThreadMessageView } from '../../src/lib/gateway';

export default function Loss() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gateway } = useSession();
  const [message, setMessage] = useState<ThreadMessageView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void gateway.message(id).then(setMessage);
  }, [gateway, id]);

  const relight = useCallback(async () => {
    if (message === null) return;
    setBusy(true);
    try {
      const result = await gateway.resend(message.id);
      router.replace(`/flight/${result.messageId}`);
    } finally {
      setBusy(false);
    }
  }, [gateway, message]);

  if (message === null) {
    return (
      <Screen>
        <Small tone="faint">…</Small>
      </Screen>
    );
  }

  const lostCell = message.lostCell ?? message.originCell;
  const fromHome = haversineKm(cellCenter(message.originCell), cellCenter(lostCell));
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
    new Date(),
  );

  return (
    <Screen>
      <Display tone="soft">The sky took this one.</Display>
      <Body tone="faint">
        {formatDistance(fromHome)} from home
        {towerPhrase(lostCell) !== null ? `, near ${towerPhrase(lostCell)}` : ''}.
      </Body>

      <SkyPanel region={regionFor(message.route ?? [lostCell])} height={300}>
        <RouteLine flown={snapshot.flown} ahead={[]} dimmed />
        <SmokeMarker snapshot={snapshot} state="LOST" />
      </SkyPanel>

      <Card>
        <Caption>What happened</Caption>
        <Body tone="soft">{message.body ?? ''}</Body>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Why</Small>
          <Mono style={{ color: sky.lost }}>{reasonText(message.lostReason)}</Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">When</Small>
          <Mono>{formatSince(message.lostAt ?? message.createdAt)}</Mono>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Where</Small>
          <Mono>{lostCell}</Mono>
        </Row>
      </Card>

      <Small tone="faint">
        It waited out a storm for more than a day, and then it was gone. Nothing else in
        SMOKE can take a message — only the weather.
      </Small>

      <Button label="Light a new fire" onPress={() => void relight()} loading={busy} />
      <Button label="Back to the ledger" variant="ghost" onPress={() => router.replace('/ledger')} />
    </Screen>
  );
}

function reasonText(reason: string | null): string {
  switch (reason) {
    case 'dissipated':
      return 'dissipated while sheltering';
    default:
      return reason ?? 'unknown';
  }
}
