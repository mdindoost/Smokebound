/**
 * A conversation (ARCHITECTURE §7.4).
 *
 * Outbound messages show their whole flight — transmitting, in the air,
 * sheltering, arrived, lost — because the sender owns that story. Inbound
 * messages appear only once they land: before that the row is invisible to the
 * recipient (RLS, ARCHITECTURE §3; SPEC §4.4).
 *
 * The safety surface (App Store 1.2, REDTEAM F1) is reachable from right here:
 * report a message, block the person, unfriend them.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import {
  Banner,
  Body,
  Bubble,
  Button,
  Caption,
  Card,
  GarbledBody,
  Mono,
  Row,
  Screen,
  Small,
  StateChip,
  Title,
} from '../../src/design/components.js';
import { spacing, stateColor } from '../../src/design/tokens.js';
import { stateBlurb, stateLabel } from '../../src/lib/copy.js';
import { formatEta, formatSince } from '../../src/lib/format.js';
import { displayText, isWindDamaged } from '../../src/lib/mapping.js';
import { useSession } from '../../src/lib/session.js';
import type { ProfileView, ThreadMessageView } from '../../src/lib/gateway.js';

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gateway } = useSession();

  const [messages, setMessages] = useState<ThreadMessageView[]>([]);
  const [other, setOther] = useState<ProfileView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [thread, flock] = await Promise.all([gateway.thread(id), gateway.listFlock()]);
    setMessages(thread);
    setOther(flock.find((entry) => entry.profile.id === id)?.profile ?? null);
  }, [gateway, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const report = (message: ThreadMessageView): void => {
    Alert.prompt?.('Report this message', 'What is wrong with it?', async (reason) => {
      await gateway.reportMessage(message.id, reason ?? 'unspecified');
      Alert.alert('Reported', 'Thank you. A human will read this.');
    });
  };

  const block = (): void => {
    Alert.alert(
      `Block @${other?.handle ?? 'them'}?`,
      'They will not be able to send you smoke, and you will not see theirs. They are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void gateway
              .block(id)
              .then(() => router.replace('/ledger'))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const unfriend = (): void => {
    Alert.alert(`Remove @${other?.handle ?? 'them'} from your flock?`, 'You can add them again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void gateway
            .removeFlock(id)
            .then(() => router.replace('/ledger'))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>@{other?.handle ?? '…'}</Title>
        <Button
          label="Light a fire"
          variant="secondary"
          onPress={() => router.push({ pathname: '/compose', params: { recipient: id } })}
        />
      </Row>

      {messages.length === 0 && (
        <Small tone="faint">
          Nothing here yet. Anything they send you appears the moment it lands — not before.
        </Small>
      )}

      <View style={{ gap: spacing.lg }}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onReport={() => report(message)} />
        ))}
      </View>

      <Card>
        <Caption>Safety</Caption>
        <Small tone="faint">
          Every message here can be reported. Blocking is silent and immediate.
        </Small>
        <Button label="Remove from flock" variant="secondary" onPress={unfriend} disabled={busy} />
        <Button label={`Block @${other?.handle ?? ''}`} variant="danger" onPress={block} disabled={busy} />
      </Card>
    </Screen>
  );
}

function MessageBubble({
  message,
  onReport,
}: {
  message: ThreadMessageView;
  onReport: () => void;
}) {
  const text = displayText(message);
  const damaged = isWindDamaged(message);

  return (
    <Bubble
      direction={message.direction}
      footer={
        <View style={{ gap: spacing.xs }}>
          <Row>
            <StateChip label={stateLabel(message.state)} color={stateColor(message.state)} />
            <Caption>{formatSince(message.createdAt)}</Caption>
          </Row>
          {message.direction === 'out' && message.state !== 'DELIVERED' && (
            <Small tone="faint">{stateBlurb(message.state)}</Small>
          )}
          {message.direction === 'out' && message.eta !== null && message.state !== 'DELIVERED' && (
            <Mono>arrives {formatEta(message.eta)}</Mono>
          )}
          {message.state === 'LOST' && (
            <Mono tone="faint">
              lost at {message.lostCell ?? '—'} · {message.lostReason ?? 'dissipated'}
            </Mono>
          )}
          {message.direction === 'in' && (
            <Pressable accessibilityRole="button" onPress={onReport}>
              <Caption tone="accent">Report</Caption>
            </Pressable>
          )}
        </View>
      }
    >
      {damaged ? <GarbledBody text={text ?? ''} /> : <Body>{text ?? ''}</Body>}
      {damaged && (
        <Banner tone="warn">
          <Caption tone="accent">Wind-damaged</Caption>
          <Small tone="soft">
            A gale got at this on the way. What arrived is what you see; the original is gone.
          </Small>
        </Banner>
      )}
    </Bubble>
  );
}
