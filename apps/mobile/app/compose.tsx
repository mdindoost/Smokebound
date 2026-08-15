/**
 * Compose (ARCHITECTURE §7.2): pick someone, write, look at the sky, commit.
 *
 * The preview is a map (M5): the route it would fly, the storms it steers
 * around, and the numbers underneath — plus the proximity joke when the two
 * fires are close enough to walk between (MECHANICS §7.1).
 *
 * Two rules from the spec show up as code here:
 *   * the counter counts **grapheme clusters** (REDTEAM F20) — 280 emoji is a
 *     legal message and the counter has to agree;
 *   * a closed sky is not an error (REDTEAM F17) — you can still light the fire,
 *     and it waits.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Mono,
  Row,
  Screen,
  Small,
  Title,
} from '../src/design/components';
import { colors, spacing } from '../src/design/tokens';
import { SkyPanel } from '../src/map/SkyPanel';
import { RouteLine, StormMark } from '../src/map/SmokeTrail';
import { regionFor } from '../src/lib/flight';
import { etaWarningCopy, proximityCopy, routeSummary } from '../src/lib/copy';
import { formatTransmission } from '../src/lib/format';
import { countGraphemes } from '../src/lib/graphemes';
import { useSession } from '../src/lib/session';
import type { FlockEntry } from '../src/lib/gateway';
import type { PreviewResult } from '../src/lib/engineTypes';

export default function Compose() {
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();
  const { gateway } = useSession();

  const [flock, setFlock] = useState<FlockEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(recipient ?? null);
  const [body, setBody] = useState('');
  const [charCap, setCharCap] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void gateway.listFlock().then((entries) => setFlock(entries.filter((e) => e.status === 'accepted')));
    void gateway
      .mechanics()
      .then((mechanics) => setCharCap(mechanics.charCap))
      .catch((err: unknown) => setError((err as Error).message));
  }, [gateway]);

  const used = useMemo(() => countGraphemes(body), [body]);
  const overCap = charCap !== null && used > charCap;
  const canPreview = selected !== null && used > 0 && !overCap;

  const runPreview = useCallback(async () => {
    if (!canPreview || selected === null) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await gateway.preview(selected, body));
    } catch (err) {
      setError((err as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [body, canPreview, gateway, selected]);

  const send = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.send(selected, body, preview?.previewToken);

      if (result.etaWarning !== null) {
        Alert.alert('The sky moved', etaWarningCopy(result.etaWarning));
      } else if (result.noRoute) {
        Alert.alert(
          'Your fire is lit',
          'The sky is closed right now. Your signal waits at your fire and leaves the moment a gap opens.',
        );
      }
      router.replace(`/thread/${selected}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const proximity = preview !== null ? proximityCopy(preview.proximity) : null;

  return (
    <Screen>
      <Title>Light a fire</Title>

      {selected === null ? (
        <Card>
          <Caption>Who is this for?</Caption>
          {flock.length === 0 ? (
            <Small tone="faint">Your flock is empty. Add someone first.</Small>
          ) : (
            flock.map((entry) => (
              <Pressable
                key={entry.profile.id}
                accessibilityRole="button"
                onPress={() => setSelected(entry.profile.id)}
                style={{ paddingVertical: spacing.sm }}
              >
                <Body>
                  @{entry.profile.handle}
                  {entry.profile.isSystem === true ? ' · the Keeper' : ''}
                </Body>
              </Pressable>
            ))
          )}
        </Card>
      ) : (
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <Small tone="faint">
              To @{flock.find((e) => e.profile.id === selected)?.profile.handle ?? '…'}
            </Small>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
              <Caption tone="accent">Change</Caption>
            </Pressable>
          </Row>

          <Card>
            <Field
              label="Your message"
              placeholder="Keep it short. Smoke is not a novel."
              multiline
              numberOfLines={5}
              value={body}
              onChangeText={(text) => {
                setBody(text);
                setPreview(null);
              }}
              style={{ minHeight: 120, textAlignVertical: 'top' }}
            />
            <Row style={{ justifyContent: 'space-between' }}>
              <Caption tone={overCap ? 'accent' : 'faint'}>
                {used}/{charCap ?? '—'} characters
              </Caption>
              <Caption tone="faint">
                {formatTransmission(Math.max(1, Math.ceil(used / 4)) * 3)} of puffing
              </Caption>
            </Row>
          </Card>

          {preview === null ? (
            <Button
              label="Read the sky"
              onPress={() => void runPreview()}
              loading={busy}
              disabled={!canPreview}
            />
          ) : (
            <>
            {preview.noRoute ? null : (
              <SkyPanel
                region={regionFor(preview.route ?? [preview.originCell, preview.destCell])}
                radar
                height={240}
              >
                <RouteLine flown={[]} ahead={preview.route ?? []} />
                {preview.stormsAvoided.slice(0, 12).map((storm) => (
                  <StormMark key={storm.cell} cell={storm.cell} />
                ))}
              </SkyPanel>
            )}

            <Card>
              <Caption>The sky between you</Caption>
              {routeSummary({
                totalHours: preview.totalHours,
                eta: preview.eta,
                distanceKm: preview.proximity.distanceKm,
                stormsAvoided: preview.stormsAvoided.length,
                noRoute: preview.noRoute,
                transmissionSeconds: preview.transmissionSeconds,
              }).map((line) => (
                <Body key={line}>{line}</Body>
              ))}

              <Mono tone="faint">
                {preview.originCell} → {preview.destCell}
                {preview.route !== null ? ` · ${preview.route.length} cells` : ''}
              </Mono>

              {proximity?.headline !== null && proximity !== null && (
                <Banner tone="info">
                  <Body tone="soft">{proximity.headline}</Body>
                  <Small tone="faint">{proximity.footnote}</Small>
                </Banner>
              )}

              <Button label="Light the fire" onPress={() => void send()} loading={busy} />
              <Button label="Rewrite" variant="ghost" onPress={() => setPreview(null)} />
            </Card>
            </>
          )}
        </>
      )}

      {error !== null && (
        <View style={{ backgroundColor: colors.accentSoft, padding: spacing.md, borderRadius: 10 }}>
          <Small tone="accent">{error}</Small>
        </View>
      )}
    </Screen>
  );
}
