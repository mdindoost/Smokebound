/**
 * The Ledger: every conversation, parchment-styled (SPEC §3, ARCHITECTURE §7.4).
 *
 * Note what is *not* here: any hint of an inbound message still in the sky.
 * A recipient sees nothing until it lands — that is RLS (ARCHITECTURE §3) and
 * the product (SPEC §4.4). The row does not exist to query.
 */

import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  Divider,
  EmptyState,
  Row,
  Screen,
  Small,
  StateChip,
  Title,
} from '../src/design/components';
import { spacing, stateColor } from '../src/design/tokens';
import { stateLabel, homeLine } from '../src/lib/copy';
import { formatSince } from '../src/lib/format';
import { useNightAt } from '../src/lib/useNight';
import { useSession } from '../src/lib/session';
import type { ConversationView } from '../src/lib/gateway';

export default function Ledger() {
  const { gateway, profile } = useSession();
  const isNightAt = useNightAt(gateway);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void gateway.listConversations().then((rows) => {
        if (!alive) return;
        setConversations(rows);
        setLoading(false);
      });
      return () => {
        alive = false;
      };
    }, [gateway]),
  );

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>The Ledger</Title>
        <Link href="/sky">
          <Small tone="accent">The Sky</Small>
        </Link>
      </Row>

      {profile !== null && (
        <Small tone="faint">
          Signing as @{profile.handle} · {homeLine(profile.homeCell, isNightAt(profile.homeCell))}
        </Small>
      )}

      <Button label="Light a fire" onPress={() => router.push('/compose')} />

      {loading ? (
        <Small tone="faint">Reading the ledger…</Small>
      ) : conversations.length === 0 ? (
        <EmptyState
          title="Nothing written here yet"
          body="Add someone to your flock, or send the Keeper a signal to watch the whole thing work."
          action={<Button label="Find your flock" variant="secondary" onPress={() => router.push('/flock')} />}
        />
      ) : (
        <Card style={{ padding: 0, gap: 0 }}>
          {conversations.map((conversation, index) => (
            <View key={conversation.other.id}>
              {index > 0 && <Divider />}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/thread/${conversation.other.id}`)}
                style={{ padding: spacing.lg, gap: spacing.xs }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body>
                    @{conversation.other.handle}
                    {conversation.other.isSystem === true ? ' · the Keeper' : ''}
                  </Body>
                  <Caption>{formatSince(conversation.lastAt)}</Caption>
                </Row>
                <Small numberOfLines={1}>{conversation.lastLine || '—'}</Small>
                <Row>
                  {conversation.lastState !== null && (
                    <StateChip
                      label={stateLabel(conversation.lastState)}
                      color={stateColor(conversation.lastState)}
                    />
                  )}
                  {conversation.inFlight > 0 && (
                    <Caption tone="accent">
                      {conversation.inFlight} in the sky
                    </Caption>
                  )}
                </Row>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Row style={{ justifyContent: 'space-between' }}>
        <Link href="/settings">
          <Small tone="faint">Settings</Small>
        </Link>
        <Link href="/history">
          <Small tone="faint">Where this comes from</Small>
        </Link>
      </Row>
    </Screen>
  );
}
