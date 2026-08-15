/**
 * A map layer switch.
 *
 * Two mistakes, one after the other, both caught on a real screen.
 *
 * First these were bare accent captions — "Radar on" in the corner — which read
 * as the map stating a fact rather than offering a control. Nobody tapped them.
 *
 * Then, made into pills, they were built out of `sky.*` tokens: a dark scrim
 * fill with ember text. But the switches sit *below* the panel, on parchment,
 * and sky.ts says in its own header that those tokens are "a sub-palette used
 * inside the map surface only". The result was a chip of map floating on the
 * page — ember on dark brown, 3.8:1 at best and worse through a 72% scrim.
 *
 * So: parchment furniture, in parchment colours. The label is ink, because
 * tokens.ts reserves ember for "the only thing that ever shouts" and a layer
 * toggle has nothing to shout about. Ember survives as the state dot, which is
 * the one part that genuinely reports fire.
 */

import { Pressable, View } from 'react-native';

import { Caption } from '../design/components';
import { colors, radii, spacing } from '../design/tokens';

export function MapToggle({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label} ${on ? 'on' : 'off'}`}
      onPress={onPress}
      hitSlop={12}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: 7,
        paddingHorizontal: spacing.md,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: on ? colors.accent : colors.border,
        backgroundColor: on ? colors.surface : 'transparent',
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: on ? colors.accent : colors.textFaint,
        }}
      />
      <Caption tone={on ? 'default' : 'soft'}>{label}</Caption>
    </Pressable>
  );
}
