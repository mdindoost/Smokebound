/**
 * Root layout. M1 is scaffolding only — the real screens (Sky, Compose, Flight
 * view, Ledger, Flock, Loss, Settings) arrive in M4/M5 per ARCHITECTURE §7.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
