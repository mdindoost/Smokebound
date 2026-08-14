/**
 * Root layout: the session provider and the parchment ground everything sits on.
 *
 * Screens are M4's client shell (ARCHITECTURE §7). The map — the Sky, the flight
 * animation, the radar overlay — is M5 and deliberately absent here.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { colors, fonts } from '../src/design/tokens.js';
import { SessionProvider } from '../src/lib/session.js';
import { createGateway } from '../src/lib/supabase.js';

export default function RootLayout() {
  // One gateway for the life of the app; screens take it from the session.
  const gateway = useMemo(() => createGateway(), []);

  return (
    <SessionProvider gateway={gateway}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.accent,
          headerTitleStyle: { fontFamily: fonts.serif.default, color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="onboarding/handle" options={{ title: 'Your handle' }} />
        <Stack.Screen name="onboarding/fire" options={{ title: 'Your fire' }} />
        <Stack.Screen name="onboarding/keeper" options={{ title: 'The Keeper' }} />
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
