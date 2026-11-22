import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

export type PlanBarProps = {
  title: string
  // «3/7»
  position: string
  // null = no playable item that way.
  onPrev: (() => void) | null
  onNext: (() => void) | null
  // Panel variant only: open the plan's screen.
  onOpen?: () => void
}

// «План: <title> · 3/7» with previous/next item — over the picture (inline and
// fullscreen) and in the lesson's side panel.
export function PlanBar({
  title,
  position,
  onPrev,
  onNext,
  onOpen,
  variant,
}: PlanBarProps & { variant: "overlay" | "panel" }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const overlay = variant === "overlay"
  const color = overlay ? theme.colors.onOverlay : theme.colors.text
  const label = (
    <Text
      style={[styles.label, { color }]}
      numberOfLines={1}
      accessibilityLabel={`План ${title}, фрагмент ${position}`}
    >
      План: {title} · {position}
    </Text>
  )
  return (
    <View style={[styles.bar, overlay ? styles.barOverlay : styles.barPanel]}>
      <Pressable
        onPress={onPrev ?? undefined}
        disabled={!onPrev}
        accessibilityRole="button"
        accessibilityLabel="Предыдущий фрагмент плана"
        hitSlop={6}
        style={[styles.step, !onPrev && styles.disabled]}
      >
        <Icon name="play-skip-back" size={16} color={color} />
      </Pressable>
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityHint="Открыть план"
          style={styles.labelWrap}
        >
          {label}
        </Pressable>
      ) : (
        <View style={styles.labelWrap}>{label}</View>
      )}
      <Pressable
        onPress={onNext ?? undefined}
        disabled={!onNext}
        accessibilityRole="button"
        accessibilityLabel="Следующий фрагмент плана"
        hitSlop={6}
        style={[styles.step, !onNext && styles.disabled]}
      >
        <Icon name="play-skip-forward" size={16} color={color} />
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing(1),
      paddingVertical: 2,
    },
    barOverlay: { backgroundColor: theme.colors.overlaySoft, maxWidth: 420 },
    barPanel: {
      alignSelf: "stretch",
      backgroundColor: theme.colors.accentSoft,
      paddingVertical: theme.spacing(1),
    },
    labelWrap: { flexShrink: 1, flexGrow: 1 },
    label: { fontSize: 13, fontWeight: "700" },
    step: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    disabled: { opacity: 0.35 },
  })
