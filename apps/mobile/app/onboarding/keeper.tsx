/**
 * First run: send something to The Keeper (SPEC §3, REDTEAM F5).
 *
 * This screen exists because of the dead-air problem — a new user's first
 * message would otherwise be to a friend three states away, and their first
 * session would contain nothing but waiting. The Keeper's fire is one hill over,
 * so the whole loop happens inside an evening.
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Body, Button, Card, Screen, Small, Title } from '../../src/design/components.js';
import { KEEPER_INTRO } from '../../src/lib/copy.js';
import { useSession } from '../../src/lib/session.js';
import type { ProfileView } from '../../src/lib/gateway.js';

export default function MeetTheKeeper() {
  const { gateway } = useSession();
  const [keeper, setKeeper] = useState<ProfileView | null>(null);

  useEffect(() => {
    void gateway.keeper().then(setKeeper);
  }, [gateway]);

  return (
    <Screen>
      <Title>Someone is already listening</Title>
      <Body tone="soft">{KEEPER_INTRO}</Body>

      <Card>
        {keeper === null ? (
          <Small tone="faint">The Keeper is not tending a fire on this server yet.</Small>
        ) : (
          <Button
            label="Send the Keeper a signal"
            onPress={() =>
              router.replace({ pathname: '/compose', params: { recipient: keeper.id } })
            }
          />
        )}
        <Button label="Later — take me to the Ledger" variant="ghost" onPress={() => router.replace('/ledger')} />
      </Card>
    </Screen>
  );
}
