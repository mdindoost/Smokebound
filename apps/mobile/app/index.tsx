/**
 * The gate: send you where you actually are in the story.
 */

import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { Body, Display } from '../src/design/components';
import { colors, spacing } from '../src/design/tokens';
import { useSession } from '../src/lib/session';

export default function Index() {
  const { stage } = useSession();

  if (stage === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
        }}
      >
        <Display tone="accent">SMOKE</Display>
        <Body tone="faint">lighting the fire…</Body>
      </View>
    );
  }

  if (stage === 'signed-out') return <Redirect href="/sign-in" />;
  if (stage === 'needs-profile') return <Redirect href="/onboarding/handle" />;
  return <Redirect href="/sky" />;
}
