/**
 * The flock (SPEC §3, ARCHITECTURE §7.5) and the whole safety surface with it
 * (App Store guideline 1.2, REDTEAM F1): add, accept, decline, unfriend, block,
 * unblock — plainly, from one screen.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Field,
  Row,
  Screen,
  Small,
  Title,
} from '../src/design/components';
import { spacing } from '../src/design/tokens';
import { validateHandle } from '../src/lib/handle';
import { useSession } from '../src/lib/session';
import type { FlockEntry, ProfileView } from '../src/lib/gateway';

export default function Flock() {
  const { gateway } = useSession();
  const [entries, setEntries] = useState<FlockEntry[]>([]);
  const [blocked, setBlocked] = useState<ProfileView[]>([]);
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<ProfileView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [flock, blocks] = await Promise.all([gateway.listFlock(), gateway.listBlocked()]);
    setEntries(flock);
    setBlocked(blocks);
  }, [gateway]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const search = async (): Promise<void> => {
    const check = validateHandle(handle);
    if (!check.ok) {
      setNote(check.message);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const profile = await gateway.findByHandle(handle.trim());
      setFound(profile);
      if (profile === null) setNote('No fire by that name.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: Promise<void>, message: string): Promise<void> => {
    setBusy(true);
    try {
      await action;
      setNote(message);
      setFound(null);
      setHandle('');
      await load();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const accepted = entries.filter((entry) => entry.status === 'accepted');
  const incoming = entries.filter((entry) => entry.status === 'pending' && entry.incoming);
  const outgoing = entries.filter((entry) => entry.status === 'pending' && !entry.incoming);

  return (
    <Screen>
      <Title>Your flock</Title>

      <Card>
        <Caption>Add by handle</Caption>
        <Field
          placeholder="riverbend"
          autoCapitalize="none"
          autoCorrect={false}
          value={handle}
          onChangeText={setHandle}
        />
        <Button label="Look for them" onPress={() => void search()} loading={busy} />
        {found !== null && (
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>@{found.handle}</Body>
            <Button
              label="Send a request"
              variant="secondary"
              onPress={() =>
                void act(gateway.requestFlock(found.id), `A wisp is drifting toward @${found.handle}.`)
              }
            />
          </Row>
        )}
        {note !== null && <Small tone="faint">{note}</Small>}
      </Card>

      {incoming.length > 0 && (
        <Card>
          <Caption>Drifting your way</Caption>
          {incoming.map((entry) => (
            <Row key={entry.profile.id} style={{ justifyContent: 'space-between' }}>
              <Body>@{entry.profile.handle}</Body>
              <Row>
                <Button
                  label="Accept"
                  variant="secondary"
                  onPress={() =>
                    void act(gateway.acceptFlock(entry.profile.id), `@${entry.profile.handle} joined your flock.`)
                  }
                />
                <Button
                  label="Decline"
                  variant="ghost"
                  onPress={() => void act(gateway.removeFlock(entry.profile.id), 'Declined.')}
                />
              </Row>
            </Row>
          ))}
        </Card>
      )}

      {outgoing.length > 0 && (
        <Card>
          <Caption>Waiting on them</Caption>
          {outgoing.map((entry) => (
            <Row key={entry.profile.id} style={{ justifyContent: 'space-between' }}>
              <Small>@{entry.profile.handle}</Small>
              <Pressable
                accessibilityRole="button"
                onPress={() => void act(gateway.removeFlock(entry.profile.id), 'Withdrawn.')}
              >
                <Caption tone="accent">Withdraw</Caption>
              </Pressable>
            </Row>
          ))}
        </Card>
      )}

      <Card style={{ padding: 0, gap: 0 }}>
        {accepted.length === 0 ? (
          <View style={{ padding: spacing.lg }}>
            <Small tone="faint">Nobody yet. The Keeper counts, and it always answers.</Small>
          </View>
        ) : (
          accepted.map((entry, index) => (
            <View key={entry.profile.id}>
              {index > 0 && <Divider />}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/thread/${entry.profile.id}`)}
                style={{ padding: spacing.lg, gap: spacing.xs }}
              >
                <Body>
                  @{entry.profile.handle}
                  {entry.profile.isSystem === true ? ' · the Keeper' : ''}
                </Body>
                <Small tone="faint">fire in {entry.profile.homeCell ?? '—'}</Small>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      {blocked.length > 0 && (
        <Card>
          <Caption>Blocked</Caption>
          {blocked.map((profile) => (
            <Row key={profile.id} style={{ justifyContent: 'space-between' }}>
              <Small>@{profile.handle}</Small>
              <Pressable
                accessibilityRole="button"
                onPress={() => void act(gateway.unblock(profile.id), `Unblocked @${profile.handle}.`)}
              >
                <Caption tone="accent">Unblock</Caption>
              </Pressable>
            </Row>
          ))}
        </Card>
      )}
    </Screen>
  );
}
