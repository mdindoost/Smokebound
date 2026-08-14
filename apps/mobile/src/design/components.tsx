/**
 * The component set (SPEC §2 tone; ARCHITECTURE §7 screens).
 *
 * Small on purpose. Every screen in M4 is built from these, and M5 draws the map
 * inside the same language — so a change here is a change everywhere, which is
 * exactly what a design system is for.
 */

import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PressableProps, TextInputProps, TextProps, ViewProps } from 'react-native';
import type { ReactNode } from 'react';

import { colors, elevation, fonts, radii, spacing, type } from './tokens.js';

const face = (family: keyof typeof fonts): string =>
  Platform.select({
    ios: fonts[family].ios,
    android: fonts[family].android,
    default: fonts[family].default,
  }) as string;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Tone = 'default' | 'soft' | 'faint' | 'accent' | 'distance';

const toneColor: Record<Tone, string> = {
  default: colors.text,
  soft: colors.textSoft,
  faint: colors.textFaint,
  accent: colors.accent,
  distance: colors.distance,
};

interface TypeProps extends TextProps {
  tone?: Tone;
  children: ReactNode;
}

export function Display({ tone = 'default', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('serif'),
          fontSize: type.display.size,
          lineHeight: type.display.lineHeight,
          fontWeight: type.display.weight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

export function Title({ tone = 'default', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('serif'),
          fontSize: type.title.size,
          lineHeight: type.title.lineHeight,
          fontWeight: type.title.weight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

export function Heading({ tone = 'default', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('sans'),
          fontSize: type.heading.size,
          lineHeight: type.heading.lineHeight,
          fontWeight: type.heading.weight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

export function Body({ tone = 'default', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('sans'),
          fontSize: type.body.size,
          lineHeight: type.body.lineHeight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

export function Small({ tone = 'soft', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('sans'),
          fontSize: type.small.size,
          lineHeight: type.small.lineHeight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

export function Caption({ tone = 'faint', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('sans'),
          fontSize: type.caption.size,
          lineHeight: type.caption.lineHeight,
          fontWeight: type.caption.weight,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

/** Flight data: distances, ETAs, cell ids. */
export function Mono({ tone = 'soft', style, ...props }: TypeProps) {
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: face('mono'),
          fontSize: type.small.size,
          lineHeight: type.small.lineHeight,
          color: toneColor[tone],
        },
        style,
      ]}
    />
  );
}

/**
 * Wind-damaged text (MECHANICS §6.2). The scars are shown, not hidden: the
 * original is gone and the message says so.
 */
export function GarbledBody({ text }: { text: string }) {
  return (
    <Text
      style={{
        fontFamily: face('sans'),
        fontSize: type.body.size,
        lineHeight: type.body.lineHeight,
        color: colors.text,
        letterSpacing: 0.6,
      }}
    >
      {text}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewProps['style'];
}) {
  const inner = (
    <View style={[{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }, style]}>{children}</View>
  );
  return scroll ? (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      {inner}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, backgroundColor: colors.background }}>{inner}</View>
  );
}

export function Card({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        elevation.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  return (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
  );
}

export function Row({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View
      {...props}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, style]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  ...props
}: PressableProps & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  const isFlat = variant === 'ghost';
  const background =
    variant === 'primary' ? colors.accent : variant === 'danger' ? colors.surfaceSunk : 'transparent';
  const textColor =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
        ? colors.accent
        : variant === 'secondary'
          ? colors.text
          : colors.textSoft;

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true || loading === true }}
      disabled={disabled === true || loading === true}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: radii.md,
          borderWidth: isFlat ? 0 : StyleSheet.hairlineWidth,
          borderColor: variant === 'primary' ? colors.accent : colors.border,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          alignItems: 'center',
          opacity: disabled === true || loading === true ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: face('sans'),
          fontSize: type.body.size,
          fontWeight: '600',
          color: textColor,
        }}
      >
        {loading === true ? '…' : label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...props
}: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label !== undefined && <Caption>{label}</Caption>}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        style={[
          {
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? colors.accent : colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            fontFamily: face('sans'),
            fontSize: type.body.size,
            color: colors.text,
          },
          style,
        ]}
      />
      {error ? <Small tone="accent">{error}</Small> : hint ? <Small tone="faint">{hint}</Small> : null}
    </View>
  );
}

/** A small state marker: TRANSMITTING, IN FLIGHT, SHELTERING, ARRIVED, LOST. */
export function StateChip({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: radii.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: color,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: face('sans'),
          fontSize: type.caption.size,
          fontWeight: '600',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** A thread bubble. Outbound sits right and warm; inbound left and cool. */
export function Bubble({
  direction,
  children,
  footer,
}: {
  direction: 'out' | 'in';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const outbound = direction === 'out';
  return (
    <View style={{ alignItems: outbound ? 'flex-end' : 'flex-start', gap: spacing.xs }}>
      <View
        style={{
          maxWidth: '86%',
          backgroundColor: outbound ? colors.accentSoft : colors.surface,
          borderRadius: radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: outbound ? colors.accentSoft : colors.border,
          borderBottomRightRadius: outbound ? radii.sm : radii.lg,
          borderBottomLeftRadius: outbound ? radii.lg : radii.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: spacing.xs,
        }}
      >
        {children}
      </View>
      {footer !== undefined && (
        <View style={{ maxWidth: '86%', paddingHorizontal: spacing.xs }}>{footer}</View>
      )}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl }}>
      <Title tone="soft" style={{ textAlign: 'center' }}>
        {title}
      </Title>
      <Body tone="faint" style={{ textAlign: 'center', maxWidth: 320 }}>
        {body}
      </Body>
      {action}
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: tone === 'warn' ? colors.accentSoft : colors.distanceSoft,
        borderRadius: radii.md,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      {children}
    </View>
  );
}
