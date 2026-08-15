/**
 * Root layout: the session provider and the parchment ground everything sits on.
 *
 * The whole app hangs off here: the client shell (ARCHITECTURE §7) and, since
 * M5, the Sky — the map, the radar overlay and the flight view. Chrome stays
 * parchment; the map is a dark panel inside it (DESIGN.md V1).
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';

import { setSerifLoaded } from '../src/design/components';
import { useAppFonts } from '../src/design/fonts';
import { colors, fonts } from '../src/design/tokens';
import { SessionProvider } from '../src/lib/session';
import { createGateway } from '../src/lib/supabase';

export default function RootLayout() {
  // One gateway for the life of the app; screens take it from the session.
  const gateway = useMemo(() => createGateway(), []);

  // The bundled serif (DESIGN.md V3). Nothing blocks on it: until it arrives the
  // platform serif stands in, and the swap is invisible on a warm start.
  const serifLoaded = useAppFonts();
  useEffect(() => {
    setSerifLoaded(serifLoaded);
  }, [serifLoaded]);

  return (
    <SessionProvider gateway={gateway}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.accent,
          headerTitleStyle: {
            fontFamily: serifLoaded ? fonts.serif.default : fonts.serifFallback.default,
            color: colors.text,
          },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="onboarding/handle" options={{ title: 'Your handle' }} />
        <Stack.Screen name="onboarding/fire" options={{ title: 'Your fire' }} />
        <Stack.Screen name="onboarding/keeper" options={{ title: 'The Keeper' }} />
        <Stack.Screen name="sky" options={{ title: 'The Sky' }} />
        <Stack.Screen name="flight/[id]" options={{ title: 'In flight' }} />
        <Stack.Screen name="loss/[id]" options={{ title: '', headerShown: false }} />
        <Stack.Screen name="ledger" options={{ title: 'The Ledger' }} />
        <Stack.Screen name="thread/[id]" options={{ title: '' }} />
        <Stack.Screen name="compose" options={{ title: 'Light a fire', presentation: 'modal' }} />
        <Stack.Screen name="flock" options={{ title: 'Your flock' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="history" options={{ title: 'Where this comes from' }} />
      </Stack>
    </SessionProvider>
  );
}
