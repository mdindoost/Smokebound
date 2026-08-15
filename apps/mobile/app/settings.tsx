/**
 * Settings (ARCHITECTURE §7.7): move your fire, read what is stored, leave.
 *
 * The moderation contact lives here as well as on the landing page, because a
 * reviewer looking for guideline 1.2 compliance should find it without hunting.
 */

import { towerNameFor } from '@smoke/shared';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  Mono,
  Row,
  Screen,
  Small,
  Title,
} from '../src/design/components';
import { LOCATION_EXPLANATION } from '../src/lib/copy';
import { locateFire } from '../src/lib/location';
import { useSession } from '../src/lib/session';

const MODERATION_EMAIL = 'moderation@smokebound.app';

export default function Settings() {
  const { gateway, profile, refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const moveFire = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const result = await locateFire();
    if (!result.ok) {
      setNote(result.message);
      setBusy(false);
      return;
    }
    try {
      await gateway.moveFire(result.cell);
      await refresh();
      setNote(`Your fire now burns in ${result.cell}.`);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Settings</Title>

      <Card>
        <Caption>You</Caption>
        <Body>@{profile?.handle ?? '—'}</Body>
        <Row style={{ justifyContent: 'space-between' }}>
          <Small tone="faint">Your fire</Small>
          <Body>{towerNameFor(profile?.homeCell ?? '') ?? 'unnamed ground'}</Body>
        </Row>
        <Button label="Move my fire" variant="secondary" onPress={() => void moveFire()} loading={busy} />
        {note !== null && <Small tone="faint">{note}</Small>}
      </Card>

      <Card>
        <Caption>What we store</Caption>
        <Small tone="soft">{LOCATION_EXPLANATION}</Small>
        <Small tone="soft">
          Messages are stored on our server so they can be delivered — they are not
          end-to-end encrypted, and we will not pretend otherwise.
        </Small>
      </Card>

      <Card>
        <Caption>Safety</Caption>
        <Small tone="soft">
          Report any message from its bubble in a conversation. Blocking is under the same
          menu, is silent, and takes effect immediately.
        </Small>
        <Button
          label="Contact moderation"
          variant="secondary"
          onPress={() => void Linking.openURL(`mailto:${MODERATION_EMAIL}`)}
        />
        <Small tone="faint">{MODERATION_EMAIL}</Small>
      </Card>

      <Card>
        <Caption>About</Caption>
        <Link href="/history">
          <Body tone="accent">Where this comes from</Body>
        </Link>
        <Small tone="faint">
          SMOKE has genuinely no practical use. That is the point.
        </Small>
      </Card>

      <Button
        label="Sign out"
        variant="ghost"
        onPress={() => {
          void signOut().then(() => router.replace('/sign-in'));
        }}
      />
    </Screen>
  );
}
