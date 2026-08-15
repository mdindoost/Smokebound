/**
 * The ember breathes (R23).
 *
 * A slow ~3 s swell and fade under the smoke marker, so a message in flight is
 * visibly *alive* on a map where nothing else moves. Radius and opacity only —
 * it never changes position, colour or shape, because the marker's position is
 * server truth and the one thing motion must not do here is imply movement the
 * engine has not confirmed (DESIGN.md V7).
 *
 * **Why a Circle and not the Marker.** Map markers render with
 * `tracksViewChanges={false}`, which is what keeps a panel with a dozen marks
 * usable: the platform snapshots the marker's contents once and reuses the
 * bitmap. An animated `<View>` inside a Marker therefore paints exactly once and
 * then freezes — the first attempt at night visuals failed for a related reason,
 * and this would have failed silently in the same way. A `Circle` is a native
 * map overlay that takes live props, so it animates without turning marker
 * caching off.
 *
 * Radius is in **metres**, so the breath scales with the map: at continental
 * zoom it is a soft pulse, and zoomed into one cell it is a halo around a town.
 * That is the correct behaviour for a signal fire seen from further away.
 *
 * **Reduce-motion is honoured.** With it on there is no animation at all — a
 * still circle at the mid-radius, not a slower breath. Someone who has asked
 * the system to stop moving things has asked for that.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Circle } from 'react-native-maps';
import type { LatLng } from '@smoke/shared';

import { BREATH_FRAME_MS, BREATH_PERIOD_MS, emberBreathAt } from '../design/motion';

export function BreathingEmber({
  at,
  /** Base radius in metres. Scaled by the caller from the visible span. */
  baseRadiusMeters,
  regime = 'smoke',
}: {
  at: LatLng | null;
  baseRadiusMeters: number;
  regime?: 'smoke' | 'fire';
}) {
  const [phase, setPhase] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const started = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduceMotion(on);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    // Phase from wall clock rather than a frame counter, so a dropped frame
    // shifts nothing: the breath stays on its own schedule.
    const timer = setInterval(() => {
      started.current ??= Date.now();
      setPhase(((Date.now() - started.current) % BREATH_PERIOD_MS) / BREATH_PERIOD_MS);
    }, BREATH_FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  if (at === null) return null;

  const breath = emberBreathAt(phase, reduceMotion);
  const radius = baseRadiusMeters * breath.scale;
  const alpha = breath.alpha;

  return (
    <Circle
      center={{ latitude: at.lat, longitude: at.lng }}
      radius={radius}
      strokeWidth={0}
      fillColor={
        regime === 'fire' ? `rgba(226,128,47,${alpha})` : `rgba(246,200,138,${alpha})`
      }
      zIndex={2}
    />
  );
}
