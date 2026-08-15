/**
 * Asking for location, at the coarsest resolution that works (SPEC §8,
 * ARCHITECTURE §8).
 *
 * We ask once, in the foreground, for approximate accuracy, and keep only the
 * 50 km cell — never the coordinate. The permission prompt is preceded by a
 * screen that says exactly that, because the honest version is also the one
 * that gets granted.
 */

import * as Location from 'expo-location';

import { cellFromCoordinates } from './fireCell';
import type { FireResult } from './fireCell';

export type { FireResult } from './fireCell';
export { cellFromCoordinates } from './fireCell';

export async function locateFire(): Promise<FireResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message: 'Without a rough location there is no distance for smoke to cross.',
    };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Lowest, // city-scale is all we want
    });
    return cellFromCoordinates(position.coords.latitude, position.coords.longitude);
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Could not read a location just now. Try again in a moment.',
    };
  }
}
