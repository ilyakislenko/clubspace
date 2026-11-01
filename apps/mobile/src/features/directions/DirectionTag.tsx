import React from "react"
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

/**
 * A direction's colored dot + emoji + name — on a class / event / agenda row,
 * next to a rank ladder, or as a chip (`chip`) in «Мои направления». Renders
 * nothing for a club-wide row (`null`) or a payload cached before directions.
 */
export function DirectionTag({
  direction,
  chip = false,
  style,
}: {
  direction: DirectionRef | null | undefined
  chip?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (!direction) return null
  return (
    <View
      style={[styles.tag, chip && styles.chip, style]}
      accessibilityLabel={`Направление: ${direction.name}`}
    >
      <DirectionDot color={direction.color} fallback={theme.colors.mutedFaint} />
      <Text style={[styles.label, chip && styles.chipLabel]} numberOfLines={1}>
        {direction.icon ? `${direction.icon} ` : ""}
        {direction.name}
      </Text>
    </View>
  )
}

/** The direction's color as a small round swatch (a club-set data color). */
export function DirectionDot({
  color,
  fallback,
}: {
  color: string | null
  fallback: string
}) {
  const styles = useThemedStyles(makeStyles)
  return <View style={[styles.dot, { backgroundColor: color ?? fallback }]} />
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    tag: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      flexShrink: 1,
    },
    chip: {
      paddingHorizontal: theme.spacing(2) + 2,
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: theme.radius.full,
    },
    label: {
      flexShrink: 1,
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: "600",
    },
    chipLabel: { color: theme.colors.text, fontSize: 13 },
  })
