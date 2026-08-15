/**
 * Place the user's fire (SPEC §8, ARCHITECTURE §8).
 *
 * The explanation comes *before* the system prompt, and says exactly what is
 * kept: the 50 km cell, never the coordinate, never in the background. That is
 * both the honest version and the one people say yes to.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import {
  Body,
  Button,
  Card,
  Mono,
  Screen,
  Small,
  Title,
} from '../../src/design/components';
import { LOCATION_EXPLANATION } from '../../src/lib/copy';
import { locateFire } from '../../src/lib/location';
import { useSession } from '../../src/lib/session';

export default function PlaceFire() {
  const { handle, displayName } = useLocalSearchParams<{ handle: string; displayName?: string }>();
  const { gateway, refresh } = useSession();

  const [cell, setCell] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findMe = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await locateFire();
    setBusy(false);
    if (result.ok) setCell(result.cell);
    else setError(result.message);
  };

  const claim = async (): Promise<void> => {
    if (cell === null) return;
    setBusy(true);
    setError(null);
    try {
      await gateway.claimProfile({
        handle,
        displayName: displayName === '' ? undefined : displayName,
        homeCell: cell,
      });
      await refresh();
      router.replace('/onboarding/keeper');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Where is your fire?</Title>
      <Body tone="soft">{LOCATION_EXPLANATION}</Body>

      <Card>
        {cell === null ? (
          <>
            <Button label="Find my fire" onPress={() => void findMe()} loading={busy} />
            {error !== null && <Small tone="accent">{error}</Small>}
          </>
        ) : (
          <>
            <Small tone="faint">Your fire will burn in cell</Small>
            <Mono tone="default">{cell}</Mono>
            <Small tone="faint">
              About 50 km across. Your flock sees this cell; that is how they see your smoke
              coming.
            </Small>
            <Button label="Light it here" onPress={() => void claim()} loading={busy} />
            <Button label="Try again" variant="ghost" onPress={() => void findMe()} />
            {error !== null && <Small tone="accent">{error}</Small>}
          </>
        )}
      </Card>
    </Screen>
  );
}
