/**
 * A map layer switch.
 *
 * These began as bare accent captions — "Radar on" in the corner — which read as
 * the map stating a fact rather than offering a control. Nobody tapped them. A
 * bordered pill with a state dot says exactly the same words and admits it is a
 * button.
 */

import { Pressable, View } from 'react-native';

import { Caption } from '../design/components';
import { sky } from '../design/sky';
import { spacing } from '../design/tokens';

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
        paddingVertical: 6,
        paddingHorizontal: spacing.sm,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? sky.trail : sky.line,
        backgroundColor: on ? sky.panelScrim : 'transparent',
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: on ? sky.trailGlow : sky.line,
        }}
      />
      <Caption tone={on ? 'accent' : 'faint'}>{label}</Caption>
    </Pressable>
  );
}
